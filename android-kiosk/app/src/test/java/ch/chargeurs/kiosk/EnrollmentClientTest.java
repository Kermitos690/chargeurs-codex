package ch.chargeurs.kiosk;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class EnrollmentClientTest {
    @Test
    public void acceptsOnlyExactlySixNumericDigits() {
        assertTrue(EnrollmentClient.isValidPairingCode("004821"));
        assertTrue(EnrollmentClient.isValidPairingCode("900006"));
        assertFalse(EnrollmentClient.isValidPairingCode("12345"));
        assertFalse(EnrollmentClient.isValidPairingCode("1234567"));
        assertFalse(EnrollmentClient.isValidPairingCode("12 456"));
        assertFalse(EnrollmentClient.isValidPairingCode("12.456"));
        assertFalse(EnrollmentClient.isValidPairingCode("abcdef"));
        assertFalse(EnrollmentClient.isValidPairingCode("kc_0123456789abcdef"));
    }
}
