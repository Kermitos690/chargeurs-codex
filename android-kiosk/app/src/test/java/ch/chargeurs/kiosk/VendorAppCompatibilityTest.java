package ch.chargeurs.kiosk;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class VendorAppCompatibilityTest {
    @Test
    public void detectsMissingVendorAppWithoutGuessingItsConnectionState() {
        assertEquals(
            "VENDOR_APP_NOT_INSTALLED",
            VendorAppCompatibility.classify(false, false, false)
        );
    }

    @Test
    public void detectsDisabledVendorApp() {
        assertEquals(
            "VENDOR_APP_DISABLED",
            VendorAppCompatibility.classify(true, false, true)
        );
    }

    @Test
    public void keepsAnInstalledVendorAppOutsideTheChargeursSandbox() {
        assertEquals(
            "VENDOR_APP_PRESENT_NO_PUBLIC_BRIDGE",
            VendorAppCompatibility.classify(true, true, true)
        );
    }
}
