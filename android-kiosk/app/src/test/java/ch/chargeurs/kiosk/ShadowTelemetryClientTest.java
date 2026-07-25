package ch.chargeurs.kiosk;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public final class ShadowTelemetryClientTest {
    @Test
    public void derivesSiblingEdgeFunctionEndpoint() {
        assertEquals(
            "https://example.supabase.co/functions/v1/device-shadow-ingest",
            ShadowTelemetryClient.deriveEndpoint(
                "https://example.supabase.co/functions/v1/kiosk-enroll"
            )
        );
    }

    @Test
    public void rejectsNonHttpsOrNonFunctionUrls() {
        assertNull(ShadowTelemetryClient.deriveEndpoint(
            "http://example.supabase.co/functions/v1/kiosk-enroll"
        ));
        assertNull(ShadowTelemetryClient.deriveEndpoint(
            "https://example.supabase.co/kiosk-enroll"
        ));
    }
}
