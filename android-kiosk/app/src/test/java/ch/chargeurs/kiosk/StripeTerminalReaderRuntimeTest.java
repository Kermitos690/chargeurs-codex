package ch.chargeurs.kiosk;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Keeps the field diagnostics aligned with the SDK pinned in build.gradle.kts. */
public final class StripeTerminalReaderRuntimeTest {
    @Test
    public void reportsThePinnedTerminalSdkVersion() {
        assertEquals("3.0.0-test-only", StripeTerminalReaderRuntime.SDK_COMPAT);
    }
}
