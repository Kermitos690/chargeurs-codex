package ch.chargeurs.kiosk;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class VendorDexCallGraphAnalyzerTest {
    @Test
    public void decodesInvokeAndConstWidths() {
        assertEquals(3, width(0x006e, 0x0001, 0x0000));
        assertEquals(3, width(0x0074, 0x0001, 0x0000));
        assertEquals(2, width(0x001a, 0x0001));
        assertEquals(3, width(0x001b, 0x0001, 0x0000));
        assertEquals(5, width(0x0018, 0x0000, 0x0000, 0x0000, 0x0000));
    }

    @Test
    public void decodesPackedSwitchPayloadWidth() {
        assertEquals(8, width(
            0x0100,
            0x0002,
            0x0000, 0x0000,
            0x0000, 0x0000,
            0x0000, 0x0000
        ));
    }

    @Test
    public void decodesSparseSwitchPayloadWidth() {
        assertEquals(10, width(
            0x0200,
            0x0002,
            0x0000, 0x0000, 0x0000, 0x0000,
            0x0000, 0x0000, 0x0000, 0x0000
        ));
    }

    @Test
    public void decodesFillArrayPayloadWidth() {
        assertEquals(7, width(
            0x0300,
            0x0001,
            0x0005, 0x0000,
            0x0000, 0x0000, 0x0000
        ));
    }

    private static int width(int... codeUnits) {
        byte[] data = new byte[codeUnits.length * 2];
        for (int index = 0; index < codeUnits.length; index++) {
            data[index * 2] = (byte) (codeUnits[index] & 0xff);
            data[index * 2 + 1] = (byte) ((codeUnits[index] >>> 8) & 0xff);
        }
        return VendorDexCallGraphAnalyzer.instructionWidth(data, 0, 0, codeUnits.length);
    }
}
