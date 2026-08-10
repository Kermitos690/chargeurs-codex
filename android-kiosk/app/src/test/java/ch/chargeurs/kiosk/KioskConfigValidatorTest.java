package ch.chargeurs.kiosk;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class KioskConfigValidatorTest {
    @Test
    public void acceptsKnownStationShapes() {
        assertTrue(KioskConfigValidator.isValidStationId("DTA21269"));
        assertTrue(KioskConfigValidator.isValidStationId("station_test-01"));
    }

    @Test
    public void rejectsUnsafeStationShapes() {
        assertFalse(KioskConfigValidator.isValidStationId("abc"));
        assertFalse(KioskConfigValidator.isValidStationId("DTA/21269"));
        assertFalse(KioskConfigValidator.isValidStationId("DTA 21269"));
    }

    @Test
    public void validatesOpaqueKioskTokens() {
        assertTrue(KioskConfigValidator.isValidToken("0123456789abcdef"));
        assertFalse(KioskConfigValidator.isValidToken("too-short"));
        assertFalse(KioskConfigValidator.isValidToken("0123456789abcdef<script>"));
    }

    @Test
    public void normalizesOnlyHttpsOrigins() {
        assertEquals("https://chargeurs.ch", KioskConfigValidator.normalizeBaseUrl("https://Chargeurs.ch/"));
        assertEquals("https://kiosk.chargeurs.ch", KioskConfigValidator.normalizeBaseUrl("https://kiosk.chargeurs.ch"));
        assertNull(KioskConfigValidator.normalizeBaseUrl("http://chargeurs.ch"));
        assertNull(KioskConfigValidator.normalizeBaseUrl("https://user@chargeurs.ch"));
        assertNull(KioskConfigValidator.normalizeBaseUrl("https://chargeurs.ch/kiosk"));
        assertNull(KioskConfigValidator.normalizeBaseUrl("https://chargeurs.ch?token=x"));
    }

    @Test
    public void restrictsTopLevelNavigationToTheConfiguredOrigin() {
        assertTrue(KioskConfigValidator.isAllowedUrl(
            "https://chargeurs.ch/kiosk/DTA21269",
            "https://chargeurs.ch"
        ));
        assertFalse(KioskConfigValidator.isAllowedUrl(
            "https://stripe.com/pay",
            "https://chargeurs.ch"
        ));
        assertFalse(KioskConfigValidator.isAllowedUrl(
            "javascript:alert(1)",
            "https://chargeurs.ch"
        ));
        assertFalse(KioskConfigValidator.isAllowedUrl(
            "https://chargeurs.ch.evil.example/kiosk/DTA21269",
            "https://chargeurs.ch"
        ));
    }

    @Test
    public void buildsTheLockedKioskRoute() {
        assertEquals(
            "https://chargeurs.ch/kiosk/DTA21269",
            KioskConfigValidator.kioskUrl("https://chargeurs.ch", "DTA21269")
        );
        assertThrows(IllegalArgumentException.class, () ->
            KioskConfigValidator.kioskUrl("http://chargeurs.ch", "DTA21269")
        );
    }

    @Test
    public void enrollmentOriginMustMatchThePinnedBuildOrigin() {
        assertTrue(KioskConfigValidator.matchesPinnedBaseUrl(
            "https://chargeurs-ch-staging.vercel.app/",
            "https://chargeurs-ch-staging.vercel.app"
        ));
        assertFalse(KioskConfigValidator.matchesPinnedBaseUrl(
            "https://chargeurs.ch",
            "https://chargeurs-ch-staging.vercel.app"
        ));
        assertFalse(KioskConfigValidator.matchesPinnedBaseUrl(
            "http://chargeurs-ch-staging.vercel.app",
            "https://chargeurs-ch-staging.vercel.app"
        ));
    }

    @Test
    public void acceptsOnlyHttpsEnrollmentEndpoints() {
        assertEquals(
            "https://example.supabase.co/functions/v1/kiosk-enroll",
            KioskConfigValidator.normalizeHttpsEndpoint("https://example.supabase.co/functions/v1/kiosk-enroll")
        );
        assertNull(KioskConfigValidator.normalizeHttpsEndpoint("http://example.test/kiosk-enroll"));
        assertNull(KioskConfigValidator.normalizeHttpsEndpoint("https://example.test"));
        assertNull(KioskConfigValidator.normalizeHttpsEndpoint("https://user@example.test/kiosk-enroll"));
        assertNull(KioskConfigValidator.normalizeHttpsEndpoint("https://example.test/kiosk-enroll?token=x"));
    }
}
