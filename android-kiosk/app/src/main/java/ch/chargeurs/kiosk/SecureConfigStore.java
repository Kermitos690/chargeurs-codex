package ch.chargeurs.kiosk;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.ProviderException;
import java.security.SecureRandom;
import java.security.UnrecoverableKeyException;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Stores only the kiosk bearer token encrypted at rest. The primary format is
 * an AndroidKeyStore AES/GCM key. Some industrial Android images expose an
 * incomplete AES Keymaster while still providing an RSA AndroidKeyStore. For
 * those devices a random AES content key is wrapped by an AndroidKeyStore RSA
 * key pair. No software-only or plaintext fallback exists.
 */
public final class SecureConfigStore {
    private static final String PREFS = "chargeurs_kiosk_config";
    private static final String AES_KEY_ALIAS = "chargeurs_kiosk_token_key_v1";
    private static final String RSA_KEY_ALIAS = "chargeurs_kiosk_token_wrap_key_v1";
    private static final String STATION = "station_id";
    private static final String BASE_URL = "base_url";
    private static final String TOKEN_CIPHER = "token_cipher";
    private static final String TOKEN_IV = "token_iv";
    private static final String CRYPTO_MODE = "token_crypto_mode";
    private static final String WRAPPED_CONTENT_KEY = "wrapped_content_key";
    private static final String STORAGE_PROBE = "storage_probe";
    private static final String MODE_AES_KEYSTORE = "AES_KEYSTORE";
    private static final String MODE_RSA_WRAPPED_AES = "RSA_WRAPPED_AES";
    private static final int GCM_TAG_BITS = 128;
    private static final int CONTENT_KEY_BYTES = 32;
    private static final byte[] PROBE_PLAINTEXT = "chargeurs-storage-probe-v2".getBytes(StandardCharsets.UTF_8);

    private final SharedPreferences preferences;

    public SecureConfigStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Proves that the local primitives used by enrollment are available. */
    public synchronized StorageHealth prepareForEnrollment() {
        StorageHealth initial = probeBestSupportedStorage();
        if (initial.ready || !initial.keyMaterialFailure) return initial;

        // Repair only Chargeurs aliases/config, never the vendor application.
        if (!deleteOwnKeys()) return StorageHealth.failure("KEYSTORE_REPAIR_FAILED", true, false, "NONE", "KeyStoreException");
        clearStoredConfiguration();
        StorageHealth repaired = probeBestSupportedStorage();
        return repaired.ready
            ? StorageHealth.ready(true, repaired.mode)
            : StorageHealth.failure(repaired.code, repaired.keyMaterialFailure, true, repaired.mode, repaired.failureKind);
    }

    /** Read-only status for Diagnostics. It never rotates or deletes a key. */
    public synchronized StorageHealth inspect() {
        return probeBestSupportedStorage();
    }

    public synchronized SaveResult save(KioskConfig config) {
        if (config == null || !config.isValid()) return SaveResult.failure("INVALID_KIOSK_CONFIGURATION");

        StorageHealth readiness = prepareForEnrollment();
        if (!readiness.ready) return SaveResult.failure(readiness.code);

        SaveResult firstAttempt = saveOnce(config, readiness.mode);
        if (firstAttempt.saved || !firstAttempt.keyMaterialFailure) return firstAttempt;

        if (!deleteOwnKeys()) return SaveResult.failure("KEYSTORE_REPAIR_FAILED");
        clearStoredConfiguration();
        StorageHealth repaired = probeBestSupportedStorage();
        if (!repaired.ready) return SaveResult.failure(repaired.code);
        return saveOnce(config, repaired.mode);
    }

    public synchronized KioskConfig load() {
        String station = preferences.getString(STATION, null);
        String baseUrl = preferences.getString(BASE_URL, null);
        String encrypted = preferences.getString(TOKEN_CIPHER, null);
        String iv = preferences.getString(TOKEN_IV, null);
        if (station == null || baseUrl == null || encrypted == null || iv == null) return null;

        try {
            String mode = preferences.getString(CRYPTO_MODE, MODE_AES_KEYSTORE);
            SecretKey key = resolveStoredContentKey(mode);
            String token = decrypt(key, encrypted, iv);
            KioskConfig config = new KioskConfig(station, token, baseUrl);
            return config.isValid() ? config : null;
        } catch (Exception exception) {
            clear();
            return null;
        }
    }

    public synchronized void clear() {
        clearStoredConfiguration();
    }

    private SaveResult saveOnce(KioskConfig config, String requestedMode) {
        try {
            ContentKey contentKey = createContentKey(requestedMode);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, contentKey.key);
            byte[] encrypted = cipher.doFinal(config.kioskToken().getBytes(StandardCharsets.UTF_8));
            SharedPreferences.Editor editor = preferences.edit()
                .putString(STATION, config.stationId().trim())
                .putString(BASE_URL, KioskConfigValidator.normalizeBaseUrl(config.baseUrl()))
                .putString(TOKEN_CIPHER, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString(TOKEN_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString(CRYPTO_MODE, contentKey.mode)
                .remove(STORAGE_PROBE);
            if (contentKey.wrappedKey == null) editor.remove(WRAPPED_CONTENT_KEY);
            else editor.putString(WRAPPED_CONTENT_KEY, contentKey.wrappedKey);
            if (!editor.commit()) return SaveResult.failure("PREFERENCES_WRITE_FAILED");

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

    private StorageHealth probeBestSupportedStorage() {
        StorageHealth primary = probeStorage(MODE_AES_KEYSTORE);
        if (primary.ready || !primary.keyMaterialFailure) return primary;
        StorageHealth compatible = probeStorage(MODE_RSA_WRAPPED_AES);
        return compatible.ready ? compatible : primary.prefer(compatible);
    }

    private StorageHealth probeStorage(String mode) {
        try {
            ContentKey material = createContentKey(mode);
            Cipher encrypt = Cipher.getInstance("AES/GCM/NoPadding");
            encrypt.init(Cipher.ENCRYPT_MODE, material.key);
            byte[] encrypted = encrypt.doFinal(PROBE_PLAINTEXT);
            Cipher decrypt = Cipher.getInstance("AES/GCM/NoPadding");
            decrypt.init(Cipher.DECRYPT_MODE, material.key, new GCMParameterSpec(GCM_TAG_BITS, encrypt.getIV()));
            if (!Arrays.equals(PROBE_PLAINTEXT, decrypt.doFinal(encrypted))) {
                return StorageHealth.failure("KEYSTORE_ROUND_TRIP_FAILED", true, false, mode, "RoundTripMismatch");
            }
            boolean wroteProbe = preferences.edit().putString(STORAGE_PROBE, "ok").commit();
            boolean removedProbe = preferences.edit().remove(STORAGE_PROBE).commit();
            if (!wroteProbe || !removedProbe) {
                return StorageHealth.failure("PREFERENCES_WRITE_FAILED", false, false, mode, "SharedPreferences");
            }
            return StorageHealth.ready(false, mode);
        } catch (Exception error) {
            return StorageHealth.failure(classify(error), isKeyMaterialFailure(error), false, mode, failureKind(error));
        }
    }

    private ContentKey createContentKey(String requestedMode) throws Exception {
        if (MODE_RSA_WRAPPED_AES.equals(requestedMode)) {
            byte[] bytes = new byte[CONTENT_KEY_BYTES];
            new SecureRandom().nextBytes(bytes);
            SecretKey contentKey = new SecretKeySpec(bytes, "AES");
            byte[] wrapped = rsaCipher(Cipher.ENCRYPT_MODE).doFinal(bytes);
            if (!Arrays.equals(bytes, rsaCipher(Cipher.DECRYPT_MODE).doFinal(wrapped))) {
                throw new KeyStoreException("RSA_WRAP_ROUND_TRIP_FAILED");
            }
            return new ContentKey(MODE_RSA_WRAPPED_AES, contentKey, Base64.encodeToString(wrapped, Base64.NO_WRAP));
        }
        return new ContentKey(MODE_AES_KEYSTORE, getOrCreateAesKey(), null);
    }

    private SecretKey resolveStoredContentKey(String mode) throws Exception {
        if (MODE_RSA_WRAPPED_AES.equals(mode)) {
            String wrapped = preferences.getString(WRAPPED_CONTENT_KEY, null);
            if (wrapped == null || wrapped.isEmpty()) throw new KeyStoreException("MISSING_WRAPPED_CONTENT_KEY");
            byte[] bytes = rsaCipher(Cipher.DECRYPT_MODE).doFinal(Base64.decode(wrapped, Base64.NO_WRAP));
            if (bytes.length != CONTENT_KEY_BYTES) throw new KeyStoreException("INVALID_WRAPPED_CONTENT_KEY");
            return new SecretKeySpec(bytes, "AES");
        }
        if (!MODE_AES_KEYSTORE.equals(mode)) throw new KeyStoreException("UNKNOWN_CRYPTO_MODE");
        return getOrCreateAesKey();
    }

    private String decrypt(SecretKey key, String encrypted, String iv) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, Base64.decode(iv, Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    private void clearStoredConfiguration() {
        preferences.edit()
            .remove(STATION).remove(BASE_URL).remove(TOKEN_CIPHER).remove(TOKEN_IV)
            .remove(CRYPTO_MODE).remove(WRAPPED_CONTENT_KEY).remove(STORAGE_PROBE)
            .apply();
    }

    private boolean deleteOwnKeys() {
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias(AES_KEY_ALIAS)) keyStore.deleteEntry(AES_KEY_ALIAS);
            if (keyStore.containsAlias(RSA_KEY_ALIAS)) keyStore.deleteEntry(RSA_KEY_ALIAS);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private SecretKey getOrCreateAesKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(AES_KEY_ALIAS)) {
            java.security.Key key = keyStore.getKey(AES_KEY_ALIAS, null);
            if (!(key instanceof SecretKey)) throw new KeyStoreException("CHARGEURS_AES_KEY_NOT_SECRET");
            return (SecretKey) key;
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(AES_KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    private Cipher rsaCipher(int mode) throws Exception {
        KeyPair pair = getOrCreateRsaKeyPair();
        Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
        cipher.init(mode, mode == Cipher.ENCRYPT_MODE ? pair.getPublic() : pair.getPrivate());
        return cipher;
    }

    private KeyPair getOrCreateRsaKeyPair() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(RSA_KEY_ALIAS)) {
            java.security.cert.Certificate certificate = keyStore.getCertificate(RSA_KEY_ALIAS);
            java.security.Key privateKey = keyStore.getKey(RSA_KEY_ALIAS, null);
            if (certificate == null || !(privateKey instanceof java.security.PrivateKey)) {
                throw new KeyStoreException("CHARGEURS_RSA_KEY_INCOMPLETE");
            }
            return new KeyPair(certificate.getPublicKey(), (java.security.PrivateKey) privateKey);
        }
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
        generator.initialize(new KeyGenParameterSpec.Builder(RSA_KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(2048)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            .setDigests(KeyProperties.DIGEST_SHA256)
            .build());
        return generator.generateKeyPair();
    }

    private static boolean isKeyMaterialFailure(Throwable error) {
        for (Throwable current = error; current != null; current = current.getCause()) {
            if (current instanceof KeyStoreException || current instanceof UnrecoverableKeyException
                || current instanceof InvalidKeyException || current instanceof ProviderException
                || current instanceof android.security.keystore.KeyPermanentlyInvalidatedException) return true;
            String name = current.getClass().getSimpleName();
            if (name.contains("KeyStore") || name.contains("KeyPermanently") || name.contains("UnrecoverableKey")) return true;
        }
        return false;
    }

    private static String classify(Throwable error) {
        if (isKeyMaterialFailure(error)) return "KEYSTORE_UNAVAILABLE";
        if (error instanceof javax.crypto.AEADBadTagException) return "KEYSTORE_DECRYPTION_FAILED";
        return "SECURE_STORAGE_UNAVAILABLE";
    }

    private static String failureKind(Throwable error) {
        String kind = error == null ? "Unknown" : error.getClass().getSimpleName();
        return kind.replaceAll("[^A-Za-z0-9_]", "");
    }

    private static final class ContentKey {
        final String mode;
        final SecretKey key;
        final String wrappedKey;
        ContentKey(String mode, SecretKey key, String wrappedKey) { this.mode = mode; this.key = key; this.wrappedKey = wrappedKey; }
    }

    public static final class StorageHealth {
        private final boolean ready;
        private final String code;
        private final boolean keyMaterialFailure;
        private final boolean repaired;
        private final String mode;
        private final String failureKind;
        private StorageHealth(boolean ready, String code, boolean keyMaterialFailure, boolean repaired, String mode, String failureKind) {
            this.ready = ready; this.code = code; this.keyMaterialFailure = keyMaterialFailure;
            this.repaired = repaired; this.mode = mode; this.failureKind = failureKind;
        }
        static StorageHealth ready(boolean repaired, String mode) { return new StorageHealth(true, repaired ? "KEYSTORE_REPAIRED" : "READY", false, repaired, mode, ""); }
        static StorageHealth failure(String code, boolean keyMaterialFailure, boolean repaired, String mode, String failureKind) {
            return new StorageHealth(false, code, keyMaterialFailure, repaired, mode, failureKind);
        }
        StorageHealth prefer(StorageHealth alternative) {
            if (!alternative.keyMaterialFailure) return alternative;
            return new StorageHealth(false, code, true, repaired || alternative.repaired, mode, failureKind);
        }
        public boolean isReady() { return ready; }
        public String code() { return code; }
        public boolean wasRepaired() { return repaired; }
        public String mode() { return mode; }
        public String failureKind() { return failureKind; }
    }

    public static final class SaveResult {
        private final boolean saved;
        private final String code;
        private final boolean keyMaterialFailure;
        private SaveResult(boolean saved, String code, boolean keyMaterialFailure) { this.saved = saved; this.code = code; this.keyMaterialFailure = keyMaterialFailure; }
        static SaveResult success() { return new SaveResult(true, "SAVED", false); }
        static SaveResult failure(String code) { return new SaveResult(false, code, false); }
        static SaveResult failure(String code, boolean keyMaterialFailure) { return new SaveResult(false, code, keyMaterialFailure); }
        public boolean isSaved() { return saved; }
        public String code() { return code; }
    }
}
