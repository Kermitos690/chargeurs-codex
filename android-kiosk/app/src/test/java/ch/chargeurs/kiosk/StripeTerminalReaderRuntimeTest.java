package ch.chargeurs.kiosk;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Keeps the field diagnostics aligned with the SDK pinned in build.gradle.kts. */
public final class StripeTerminalReaderRuntimeTest {
    @Test
    public void reportsThePinnedTerminalSdkVersion() {
        assertEquals("3.0.0-test-only", StripeTerminalReaderRuntime.SDK_COMPAT);
    }

    @Test
    public void rejectsStripeCallbacksFromAnOperationInvalidatedByCancellation() {
        assertTrue(StripeTerminalReaderRuntime.isCurrentPaymentOperation(14, 14));
        assertFalse(StripeTerminalReaderRuntime.isCurrentPaymentOperation(14, 15));
    }

    @Test
    public void doesNotStartAnotherUsbDiscoveryWhileStripeIsConnecting() {
        assertTrue(StripeTerminalReaderRuntime.canStartUsbDiscovery(false, false, false));
        assertFalse(StripeTerminalReaderRuntime.canStartUsbDiscovery(false, true, false));
        assertFalse(StripeTerminalReaderRuntime.canStartUsbDiscovery(true, false, false));
        assertFalse(StripeTerminalReaderRuntime.canStartUsbDiscovery(false, false, true));
    }

    @Test
    public void ignoresPaymentStateResponseThatPredatesCancellation() {
        assertTrue(StripeTerminalReaderRuntime.shouldApplyPaymentState(14, 14, "rental-a", "rental-a"));
        assertFalse(StripeTerminalReaderRuntime.shouldApplyPaymentState(14, 15, "rental-a", "rental-a"));
        assertFalse(StripeTerminalReaderRuntime.shouldApplyPaymentState(14, 14, "rental-a", null));
        assertFalse(StripeTerminalReaderRuntime.shouldApplyPaymentState(14, 14, "rental-a", "rental-b"));
    }

    @Test
    public void releasesTheUiOnlyAfterAuthoritativeBackendCancellation() {
        assertTrue(StripeTerminalReaderRuntime.isBackendCancellationConfirmed(
            new StripeTerminalBackendClient.PaymentStateResult("NONE", "CANCELLED", false, false, "")
        ));
        assertFalse(StripeTerminalReaderRuntime.isBackendCancellationConfirmed(
            new StripeTerminalBackendClient.PaymentStateResult("TERMINAL", "ENGAGED", false, false, "")
        ));
        assertFalse(StripeTerminalReaderRuntime.isBackendCancellationConfirmed(
            new StripeTerminalBackendClient.PaymentStateResult("NONE", "CANCELLED", true, false, "")
        ));
    }

    @Test
    public void onlyClearsStripeCredentialsDuringAnExplicitSafeReaderRepair() {
        assertTrue(StripeTerminalReaderRuntime.canClearCachedCredentialsForRepair("ERROR", false, null, false));
        assertFalse(StripeTerminalReaderRuntime.canClearCachedCredentialsForRepair("READY", false, null, false));
        assertFalse(StripeTerminalReaderRuntime.canClearCachedCredentialsForRepair("ERROR", true, null, false));
        assertFalse(StripeTerminalReaderRuntime.canClearCachedCredentialsForRepair("ERROR", false, "rental-a", false));
        assertFalse(StripeTerminalReaderRuntime.canClearCachedCredentialsForRepair("ERROR", false, null, true));
    }

    @Test
    public void quarantinesOnlyTheKnownStripeOfflineCacheCrash() {
        assertTrue(ChargeursKioskApplication.isRecoverableStripeOfflineCacheError(
            new RuntimeException("OfflineDecryptionException(table=offline_location)")
        ));
        assertFalse(ChargeursKioskApplication.isRecoverableStripeOfflineCacheError(
            new RuntimeException("unexpected terminal failure")
        ));
    }
}
