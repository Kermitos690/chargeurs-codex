package ch.chargeurs.kiosk;

import java.security.SecureRandom;
import java.util.Base64;

/**
 * Generates a device-side credential only for diagnostic builds. The staging
 * backend accepts it exclusively for a station explicitly marked as a pilot,
 * binds it to this Android device, stores only its SHA-256 digest and expires
 * the enrollment automatically. Release builds never use this path.
 */
public final class TestKioskToken {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int TOKEN_BYTES = 32;

    private TestKioskToken() {}

    public static String generate() {
        byte[] bytes = new byte[TOKEN_BYTES];
        RANDOM.nextBytes(bytes);
        return "kt_test_" + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static boolean isValid(String value) {
        return value != null && value.matches("^kt_test_[A-Za-z0-9_-]{43}$");
    }
}