package ch.chargeurs.kiosk;

import static org.junit.Assert.assertFalse;

import org.junit.Test;

/** The staging artifact must never be able to operate the physical cabinet. */
public final class NativeBridgeSafetyTest {
    @Test
    public void physicalEjectionIsDisabledInThisBuild() {
        assertFalse(NativeBridge.isPhysicalEjectionEnabled());
    }
}
