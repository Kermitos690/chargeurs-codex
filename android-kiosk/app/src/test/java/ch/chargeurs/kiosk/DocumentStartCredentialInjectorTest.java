package ch.chargeurs.kiosk;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Collections;

public final class DocumentStartCredentialInjectorTest {
    @Test
    public void documentStartScriptUsesSessionStorageForBearerToken() {
        String script = DocumentStartCredentialInjector.script(
            "DTA21269",
            "012345678901234567890123456789012345",
            "1.0.18-rc1-staging"
        );
        assertTrue(script.contains("sessionStorage.setItem('kiosk_token'"));
        assertTrue(script.contains("localStorage.removeItem('kiosk_token')"));
        assertFalse(script.contains("localStorage.setItem('kiosk_token'"));
        assertTrue(script.contains("kioskNativeAuth='document-start'"));
    }

    @Test
    public void injectorCanBeRestrictedToCloudflareRuntimeOrigin() {
        assertEquals(
            Collections.singleton("https://chargeurs-ch-staging-cf.pages.dev"),
            DocumentStartCredentialInjector.allowedOrigins("https://chargeurs-ch-staging-cf.pages.dev")
        );
    }

    @Test
    public void enrollmentOriginCanRemainDistinctFromRuntimeOrigin() {
        assertEquals(
            Collections.singleton("https://chargeurs-ch-staging.vercel.app"),
            DocumentStartCredentialInjector.allowedOrigins("https://chargeurs-ch-staging.vercel.app")
        );
    }

    @Test(expected = IllegalArgumentException.class)
    public void invalidOriginFailsClosed() {
        DocumentStartCredentialInjector.allowedOrigins("javascript:alert(1)");
    }
}
