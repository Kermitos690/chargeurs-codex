package ch.chargeurs.kiosk;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public final class OperatorUnlockClientTest {
    @Test
    public void derivesOperatorEndpointFromPinnedEnrollmentEndpoint() {
        assertEquals(
            "https://xqepbqnaenoeyfjkjnzl.supabase.co/functions/v1/kiosk-operator-unlock",
            OperatorUnlockClient.operatorEndpoint(
                "https://xqepbqnaenoeyfjkjnzl.supabase.co/functions/v1/kiosk-enroll"
            )
        );
    }

    @Test
    public void rejectsUnexpectedEnrollmentOriginsOrPaths() {
        assertNull(OperatorUnlockClient.operatorEndpoint("http://example.test/functions/v1/kiosk-enroll"));
        assertNull(OperatorUnlockClient.operatorEndpoint("https://example.test/functions/v1/other"));
        assertNull(OperatorUnlockClient.operatorEndpoint("https://example.test/functions/v1/kiosk-enroll?x=1"));
    }

    @Test
    public void validatesSixDigitPinWithoutEmbeddingTheConfiguredValue() {
        assertTrue(OperatorUnlockClient.isValidPin("012345"));
        assertFalse(OperatorUnlockClient.isValidPin("12345"));
        assertFalse(OperatorUnlockClient.isValidPin("1234567"));
        assertFalse(OperatorUnlockClient.isValidPin("12a456"));
    }

    @Test
    public void acceptsOnlyUuidV4DeviceIdentities() {
        assertTrue(OperatorUnlockClient.isValidDevicePublicId("123e4567-e89b-42d3-a456-426614174000"));
        assertFalse(OperatorUnlockClient.isValidDevicePublicId("123e4567-e89b-12d3-a456-426614174000"));
        assertFalse(OperatorUnlockClient.isValidDevicePublicId("not-a-uuid"));
    }
}
