package ch.chargeurs.kiosk;

import android.content.Context;
import android.content.SharedPreferences;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * Offline verifier for the local maintenance gate.
 *
 * The configured six-digit PIN is not embedded in plaintext. Only a PBKDF2
 * verifier is shipped in the native APK. This gate grants no backend role or
 * token; it only opens an exported=false Activity on the same physical tablet.
 */
final class OperatorPinVerifier {
    enum Result { ACCEPTED, REJECTED, LOCKED }

    private static final String PREFS = "chargeurs_operator_gate";
    private static final String FAILURES = "failed_attempts";
    private static final String LOCKED_UNTIL = "locked_until_epoch_ms";
    private static final byte[] SALT = "chargeurs-kiosk-operator-v1".getBytes(StandardCharsets.UTF_8);
    private static final int ITERATIONS = 120_000;
    private static final int KEY_BITS = 256;
    private static final int MAX_FAILURES = 5;
    private static final long LOCKOUT_MS = 5 * 60_000L;

    // PBKDF2-HMAC-SHA256 verifier for the owner-selected PIN. Plaintext is not
    // present in source, resources, BuildConfig, JavaScript or the Web bundle.
    private static final byte[] EXPECTED = fromHex(
        "444a92354f40f4b7c99a9158c9323731b606d67b6ea73f7aa9c118ccc0e3f7ab"
    );

    private OperatorPinVerifier() {}

    static Result verify(Context context, String pin) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long lockedUntil = prefs.getLong(LOCKED_UNTIL, 0L);
        if (lockedUntil > now) return Result.LOCKED;
        if (lockedUntil != 0L) prefs.edit().remove(LOCKED_UNTIL).putInt(FAILURES, 0).apply();

        if (!isValidPin(pin)) return Result.REJECTED;
        byte[] derived = null;
        try {
            derived = derive(pin.toCharArray(), SALT, ITERATIONS, KEY_BITS);
            if (MessageDigest.isEqual(EXPECTED, derived)) {
                prefs.edit().remove(LOCKED_UNTIL).putInt(FAILURES, 0).apply();
                return Result.ACCEPTED;
            }
        } catch (Exception error) {
            return Result.REJECTED;
        } finally {
            if (derived != null) Arrays.fill(derived, (byte) 0);
        }

        int failures = prefs.getInt(FAILURES, 0) + 1;
        SharedPreferences.Editor editor = prefs.edit();
        if (failures >= MAX_FAILURES) {
            editor.putInt(FAILURES, 0).putLong(LOCKED_UNTIL, now + LOCKOUT_MS);
        } else {
            editor.putInt(FAILURES, failures);
        }
        editor.apply();
        return failures >= MAX_FAILURES ? Result.LOCKED : Result.REJECTED;
    }

    static long remainingLockoutMs(Context context) {
        long remaining = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong(LOCKED_UNTIL, 0L) - System.currentTimeMillis();
        return Math.max(0L, remaining);
    }

    static boolean isValidPin(String pin) {
        return pin != null && pin.matches("^\\d{6}$");
    }

    static byte[] derive(char[] pin, byte[] salt, int iterations, int keyBits) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(pin, salt, iterations, keyBits);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } finally {
            spec.clearPassword();
            Arrays.fill(pin, '\0');
        }
    }

    private static byte[] fromHex(String value) {
        if (value.length() % 2 != 0) throw new IllegalArgumentException("INVALID_OPERATOR_VERIFIER");
        byte[] bytes = new byte[value.length() / 2];
        for (int index = 0; index < bytes.length; index += 1) {
            int offset = index * 2;
            bytes[index] = (byte) Integer.parseInt(value.substring(offset, offset + 2), 16);
        }
        return bytes;
    }
}
