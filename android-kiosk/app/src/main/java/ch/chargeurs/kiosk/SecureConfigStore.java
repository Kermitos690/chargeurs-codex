package ch.chargeurs.kiosk;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.ProviderException;
import java.security.UnrecoverableKeyException;
import java.util.Arrays;

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
    private static final String STORAGE_PROBE = "storage_probe";
    private static final int GCM_TAG_BITS = 128;
    private static final byte[] PROBE_PLAINTEXT = "chargeurs-storage-probe-v1".getBytes(StandardCharsets.UTF_8);

    private final SharedPreferences preferences;

    public SecureConfigStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Proves that the exact local primitives used by enrollment are available
     * before a one-time server pairing code is sent. It writes only a fixed,
     * non-sensitive marker and removes it immediately.
     */
    public synchronized StorageHealth prepareForEnrollment() {
        StorageHealth initial = probeStorage();
        if (initial.ready || !initial.keyMaterialFailure) return initial;

        // An interrupted update can leave this application's AndroidKeyStore
        // alias unusable on some vendor Android images. Repair only our own
        // alias and our own incomplete config; never touch vendor app data.
        if (!deleteOwnKey()) return StorageHealth.failure("KEYSTORE_REPAIR_FAILED", true, false);
        clearStoredConfiguration();
        StorageHealth repaired = probeStorage();
        return repaired.ready
            ? StorageHealth.ready(true)
            : StorageHealth.failure(repaired.code, repaired.keyMaterialFailure, true);
    }

    /** Read-only status for Diagnostics. It never rotates or deletes a key. */
    public synchronized StorageHealth inspect() {
        return probeStorage();
    }

    public synchronized SaveResult save(KioskConfig config) {
        if (config == null || !config.isValid()) return SaveResult.failure("INVALID_KIOSK_CONFIGURATION");

        StorageHealth readiness = prepareForEnrollment();
        if (!readiness.ready) return SaveResult.failure(readiness.code);

        SaveResult firstAttempt = saveOnce(config);
        if (firstAttempt.saved || !firstAttempt.keyMaterialFailure) return firstAttempt;

        // A key can still be invalidated between the preflight and encryption.
        // Retry once after rotating only the Chargeurs alias. The kiosk token is
        // never persisted unencrypted and is never emitted in diagnostics.
        if (!deleteOwnKey()) return SaveResult.failure("KEYSTORE_REPAIR_FAILED");
        clearStoredConfiguration();
        StorageHealth repaired = probeStorage();
        if (!repaired.ready) return SaveResult.failure(repaired.code);
        return saveOnce(config);
    }

    public synchronized KioskConfig load() {
        String station = preferences.getString(STATION, null);
        String baseUrl = preferences.getString(BASE_URL, null);
        if (station == null || baseUrl == null) return null;

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
        clearStoredConfiguration();
    }

    private SaveResult saveOnce(KioskConfig config) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(config.kioskToken().getBytes(StandardCharsets.UTF_8));
            boolean committed = preferences.edit()
                .putString(STATION, config.stationId().trim())
                .putString(BASE_URL, KioskConfigValidator.normalizeBaseUrl(config.baseUrl()))
                .putString(TOKEN_CIPHER, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString(TOKEN_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .remove(STORAGE_PROBE)
                .commit();
            if (!committed) return SaveResult.failure("PREFERENCES_WRITE_FAILED");

            KioskConfig persisted = load();
            boolean matches = persisted != null
                && config.stationId().equals(persisted.stationId())
                && config.baseUrl().equals(persisted.baseUrl())
                && config.kioskToken().equals(persisted.kioskToken());
            return matches ? SaveResult.success() : SaveResult.failure("STORAGE_VERIFY_FAILED");
        } catch (Exception error) {
            return SaveResult.failure(classify(error), isKeyMaterialFailure(error));
        }
    }

    private StorageHealth probeStorage() {
        try {
            SecretKey key = getOrCreateKey();
            Cipher encrypt = Cipher.getInstance("AES/GCM/NoPadding");
            encrypt.init(Cipher.ENCRYPT_MODE, key);
            byte[] encrypted = encrypt.doFinal(PROBE_PLAINTEXT);
            Cipher decrypt = Cipher.getInstance("AES/GCM/NoPadding");
            decrypt.init(
                Cipher.DECRYPT_MODE,
                key,
                new GCMParameterSpec(GCM_TAG_BITS, encrypt.getIV())
            );
            if (!Arrays.equals(PROBE_PLAINTEXT, decrypt.doFinal(encrypted))) {
                return StorageHealth.failure("KEYSTORE_ROUND_TRIP_FAILED", true, false);
            }
            boolean wroteProbe = preferences.edit().putString(STORAGE_PROBE, "ok").commit();
            boolean removedProbe = preferences.edit().remove(STORAGE_PROBE).commit();
            if (!wroteProbe || !removedProbe) {
                return StorageHealth.failure("PREFERENCES_WRITE_FAILED", false, false);
            }
            return StorageHealth.ready(false);
        } catch (Exception error) {
            return StorageHealth.failure(classify(error), isKeyMaterialFailure(error), false);
        }
    }

    private void clearStoredConfiguration() {
        preferences.edit()
            .remove(STATION)
            .remove(BASE_URL)
            .remove(TOKEN_CIPHER)
            .remove(TOKEN_IV)
            .remove(STORAGE_PROBE)
            .apply();
    }

    private boolean deleteOwnKey() {
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            java.security.Key key = keyStore.getKey(KEY_ALIAS, null);
            if (!(key instanceof SecretKey)) throw new KeyStoreException("CHARGEURS_KEY_NOT_SECRET");
            return (SecretKey) key;
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

    private static boolean isKeyMaterialFailure(Throwable error) {
        for (Throwable current = error; current != null; current = current.getCause()) {
            if (current instanceof KeyStoreException
                || current instanceof UnrecoverableKeyException
                || current instanceof InvalidKeyException
                || current instanceof ProviderException
                || current instanceof android.security.keystore.KeyPermanentlyInvalidatedException) {
                return true;
            }
            String name = current.getClass().getSimpleName();
            if (name.contains("KeyStore") || name.contains("KeyPermanently") || name.contains("UnrecoverableKey")) {
                return true;
            }
        }
        return false;
    }

    private static String classify(Throwable error) {
        if (isKeyMaterialFailure(error)) return "KEYSTORE_UNAVAILABLE";
        if (error instanceof javax.crypto.AEADBadTagException) return "KEYSTORE_DECRYPTION_FAILED";
        return "SECURE_STORAGE_UNAVAILABLE";
    }

    public static final class StorageHealth {
        private final boolean ready;
        private final String code;
        private final boolean keyMaterialFailure;
        private final boolean repaired;

        private StorageHealth(boolean ready, String code, boolean keyMaterialFailure, boolean repaired) {
            this.ready = ready;
            this.code = code;
            this.keyMaterialFailure = keyMaterialFailure;
            this.repaired = repaired;
        }

        static StorageHealth ready(boolean repaired) {
            return new StorageHealth(true, repaired ? "KEYSTORE_REPAIRED" : "READY", false, repaired);
        }

        static StorageHealth failure(String code, boolean keyMaterialFailure, boolean repaired) {
            return new StorageHealth(false, code, keyMaterialFailure, repaired);
        }

        public boolean isReady() { return ready; }
        public String code() { return code; }
        public boolean wasRepaired() { return repaired; }
    }

    public static final class SaveResult {
        private final boolean saved;
        private final String code;
        private final boolean keyMaterialFailure;

        private SaveResult(boolean saved, String code, boolean keyMaterialFailure) {
            this.saved = saved;
            this.code = code;
            this.keyMaterialFailure = keyMaterialFailure;
        }

        static SaveResult success() { return new SaveResult(true, "SAVED", false); }
        static SaveResult failure(String code) { return new SaveResult(false, code, false); }
        static SaveResult failure(String code, boolean keyMaterialFailure) {
            return new SaveResult(false, code, keyMaterialFailure);
        }

        public boolean isSaved() { return saved; }
        public String code() { return code; }
    }
}
