package ch.chargeurs.kiosk;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class OperatorTapSequenceTest {
    @Test
    public void fifthTapWithinThreeSecondWindowOpensGateAndResets() {
        OperatorTapSequence sequence = new OperatorTapSequence();
        assertFalse(sequence.record(1_000));
        assertFalse(sequence.record(1_600));
        assertFalse(sequence.record(2_200));
        assertFalse(sequence.record(2_800));
        assertTrue(sequence.record(4_000));
        assertFalse(sequence.record(4_100));
    }

    @Test
    public void sequencePastThreeSecondsStartsOver() {
        OperatorTapSequence sequence = new OperatorTapSequence();
        assertFalse(sequence.record(1_000));
        assertFalse(sequence.record(1_700));
        assertFalse(sequence.record(2_400));
        assertFalse(sequence.record(3_100));
        assertFalse(sequence.record(4_100));
        assertFalse(sequence.record(4_500));
        assertFalse(sequence.record(5_000));
        assertFalse(sequence.record(5_500));
        assertTrue(sequence.record(6_000));
    }

    @Test
    public void backwardClockResetsSequence() {
        OperatorTapSequence sequence = new OperatorTapSequence();
        assertFalse(sequence.record(2_000));
        assertFalse(sequence.record(2_300));
        assertFalse(sequence.record(1_900));
        assertFalse(sequence.record(2_100));
        assertFalse(sequence.record(2_300));
        assertFalse(sequence.record(2_500));
        assertTrue(sequence.record(2_700));
    }
}
