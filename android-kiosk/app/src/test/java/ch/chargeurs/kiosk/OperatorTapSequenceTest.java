package ch.chargeurs.kiosk;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class OperatorTapSequenceTest {
    @Test
    public void fifthContinuousTapOpensGateAndResets() {
        OperatorTapSequence sequence = new OperatorTapSequence();
        assertFalse(sequence.record(1_000));
        assertFalse(sequence.record(1_400));
        assertFalse(sequence.record(1_800));
        assertFalse(sequence.record(2_200));
        assertTrue(sequence.record(2_600));
        assertFalse(sequence.record(2_800));
    }

    @Test
    public void longGapResetsSequence() {
        OperatorTapSequence sequence = new OperatorTapSequence();
        assertFalse(sequence.record(1_000));
        assertFalse(sequence.record(1_400));
        assertFalse(sequence.record(1_800));
        assertFalse(sequence.record(3_000));
        assertFalse(sequence.record(3_300));
        assertFalse(sequence.record(3_600));
        assertFalse(sequence.record(3_900));
        assertTrue(sequence.record(4_200));
    }
}
