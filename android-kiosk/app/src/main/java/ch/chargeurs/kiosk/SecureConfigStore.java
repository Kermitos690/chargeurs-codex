package ch.chargeurs.kiosk;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class SecureConfigStore {
    private static final String PREFS = "chargeurs_kiosk_config";
    private static final String KEY_ALIAS = "chargeurs_kiosk_token_key_v1";
    private static final String STATION = "station_id";
    private static final String BASE_URL = "base_url";
    private static final String TOKEN_CIPHER = "token_cipher";
    private static final String TOKEN_IV = "token_iv";
    private static final String DEBUG_TOKEN_FALLBACK = "debug_token_fallback";
    private static final int GCM_TAG_BITS = 128;

    private final SharedPreferences preferences;

    public SecureConfigStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized boolean save(KioskConfig config) {
        if (config == null || !config.isValid()) return false;
        clear();
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(config.kioskToken().getBytes(StandardCharsets.UTF_8));
            return preferences.edit()
                .putString(STATION, config.stationId().trim())
                .putString(BASE_URL, KioskConfigValidator.normalizeBaseUrl(config.baseUrl()))
                .putString(TOKEN_CIPHER, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString(TOKEN_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .remove(DEBUG_TOKEN_FALLBACK)
                .commit();
        } catch (Exception exception) {
            return BuildConfig.DEBUG && saveDebugFallback(config);
        }
    }

    public synchronized KioskConfig load() {
        String station = preferences.getString(STATION, null);
        String baseUrl = preferences.getString(BASE_URL, null);
        if (station == null || baseUrl == null) return null;

        String fallback = preferences.getString(DEBUG_TOKEN_FALLBACK, null);
        if (BuildConfig.DEBUG && fallback != null) {
            try {
                String token = new String(Base64.decode(fallback, Base64.NO_WRAP), StandardCharsets.UTF_8);
                KioskConfig config = new KioskConfig(station, token, baseUrl);
                return config.isValid() ? config : null;
            } catch (Exception exception) {
                clear();
                return null;
            }
        }

        String encrypted = preferences.getString(TOKEN_CIPHER, null);
        String iv = preferences.getString(TOKEN_IV, null);
        if (encrypted == null || iv == null) return null;

        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                new GCMParameterSpec(GCM_TAG_BITS, Base64.decode(iv, Base64.NO_WRAP))
            );
            byte[] plaintext = cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP));
            KioskConfig config = new KioskConfig(
                station,
                new String(plaintext, StandardCharsets.UTF_8),
                baseUrl
            );
            return config.isValid() ? config : null;
        } catch (Exception exception) {
            clear();
            return null;
        }
    }

    public synchronized void clear() {
        preferences.edit().clear().apply();
    }

    private boolean saveDebugFallback(KioskConfig config) {
        String encoded = Base64.encodeToString(
            config.kioskToken().getBytes(StandardCharsets.UTF_8),
            Base64.NO_WRAP
        );
        return preferences.edit()
            .putString(STATION, config.stationId().trim())
            .putString(BASE_URL, KioskConfigValidator.normalizeBaseUrl(config.baseUrl()))
            .putString(DEBUG_TOKEN_FALLBACK, encoded)
            .remove(TOKEN_CIPHER)
            .remove(TOKEN_IV)
            .commit();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }
}
