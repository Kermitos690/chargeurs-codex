package ch.chargeurs.kiosk;

import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class TestKioskTokenTest {
    @Test
    public void generatesValidDistinctTokens() {
        String first = TestKioskToken.generate();
        String second = TestKioskToken.generate();

        assertTrue(TestKioskToken.isValid(first));
        assertTrue(TestKioskToken.isValid(second));
        assertNotEquals(first, second);
    }
}
