package ch.chargeurs.kiosk;

/** Small deterministic recognizer for the hidden operator corner gesture. */
final class OperatorTapSequence {
    static final int REQUIRED_TAPS = 5;
    static final long MAX_GAP_MS = 900L;

    private int tapCount;
    private long lastTapAtMs = Long.MIN_VALUE;

    boolean record(long nowMs) {
        boolean continuous = lastTapAtMs != Long.MIN_VALUE
            && nowMs >= lastTapAtMs
            && nowMs - lastTapAtMs <= MAX_GAP_MS;
        tapCount = continuous ? tapCount + 1 : 1;
        lastTapAtMs = nowMs;
        if (tapCount < REQUIRED_TAPS) return false;
        reset();
        return true;
    }

    void reset() {
        tapCount = 0;
        lastTapAtMs = Long.MIN_VALUE;
    }
}
