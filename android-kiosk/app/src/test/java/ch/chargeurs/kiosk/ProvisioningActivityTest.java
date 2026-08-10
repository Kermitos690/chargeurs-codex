package ch.chargeurs.kiosk;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class ProvisioningActivityTest {
    @Test
    public void activationControlRequiresSixDigitsButNotACompletedStoragePreflight() {
        assertFalse(ProvisioningActivity.isActivationButtonEnabled(5, false));
        assertFalse(ProvisioningActivity.isActivationButtonEnabled(7, false));
        assertFalse(ProvisioningActivity.isActivationButtonEnabled(6, true));
        assertTrue(ProvisioningActivity.isActivationButtonEnabled(6, false));
    }
}
