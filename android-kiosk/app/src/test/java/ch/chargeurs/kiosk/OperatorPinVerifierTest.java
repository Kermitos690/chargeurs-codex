package ch.chargeurs.kiosk;

import org.junit.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class OperatorPinVerifierTest {
    @Test
    public void validatesExactlySixAsciiDigits() {
        assertTrue(OperatorPinVerifier.isValidPin("012345"));
        assertFalse(OperatorPinVerifier.isValidPin("12345"));
        assertFalse(OperatorPinVerifier.isValidPin("1234567"));
        assertFalse(OperatorPinVerifier.isValidPin("12a456"));
    }

    @Test
    public void pbkdf2ContractIsStableWithoutUsingConfiguredPin() throws Exception {
        byte[] derived = OperatorPinVerifier.derive(
            "012345".toCharArray(),
            "chargeurs-kiosk-operator-v1".getBytes(StandardCharsets.UTF_8),
            120_000,
            256
        );
        assertEquals(
            "3d42f457a290217d3ffd7917bbd72d95884c71c890a771aefb08ce93617f61c8",
            hex(derived)
        );
    }

    private static String hex(byte[] value) {
        StringBuilder builder = new StringBuilder(value.length * 2);
        for (byte item : value) builder.append(String.format("%02x", item & 0xff));
        return builder.toString();
    }
}
