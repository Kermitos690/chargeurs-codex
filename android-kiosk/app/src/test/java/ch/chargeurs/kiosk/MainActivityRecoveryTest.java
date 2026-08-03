package ch.chargeurs.kiosk;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class MainActivityRecoveryTest {
    @Test
    public void webViewAlwaysSitsAboveTheOpaqueAmbientBackground() {
        assertEquals(1, MainActivity.webViewLayerIndex());
    }

    @Test
    public void networkRecoveryOnlyRestartsAfterAMainFrameFailure() {
        assertTrue(MainActivity.shouldRecoverAfterNetworkAvailable("WEBVIEW_MAIN_FRAME_ERROR", true));
        assertFalse(MainActivity.shouldRecoverAfterNetworkAvailable("WEBVIEW_UNAVAILABLE", true));
        assertFalse(MainActivity.shouldRecoverAfterNetworkAvailable("WEBVIEW_MAIN_FRAME_ERROR", false));
    }
}
