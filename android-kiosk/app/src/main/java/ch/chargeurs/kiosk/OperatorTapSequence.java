package ch.chargeurs.kiosk;

/** Small deterministic recognizer for the hidden operator corner gesture. */
final class OperatorTapSequence {
    static final int REQUIRED_TAPS = 5;
    static final long WINDOW_MS = 3_000L;

    private int tapCount;
    private long firstTapAtMs = Long.MIN_VALUE;
    private long lastTapAtMs = Long.MIN_VALUE;

    boolean record(long nowMs) {
        boolean invalidClock = lastTapAtMs != Long.MIN_VALUE && nowMs < lastTapAtMs;
        boolean outsideWindow = firstTapAtMs != Long.MIN_VALUE && nowMs - firstTapAtMs > WINDOW_MS;
        if (firstTapAtMs == Long.MIN_VALUE || invalidClock || outsideWindow) {
            tapCount = 1;
            firstTapAtMs = nowMs;
            lastTapAtMs = nowMs;
            return false;
        }

        tapCount += 1;
        lastTapAtMs = nowMs;
        if (tapCount < REQUIRED_TAPS) return false;
        reset();
        return true;
    }

    void reset() {
        tapCount = 0;
        firstTapAtMs = Long.MIN_VALUE;
        lastTapAtMs = Long.MIN_VALUE;
    }
}
