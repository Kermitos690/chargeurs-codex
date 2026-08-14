export type TimedAdEntry = {
  item: {
    mediaType: "image" | "video";
    imageDurationSeconds?: number | null;
    mediaDurationSeconds?: number | null;
  };
};

export type AdSyncPosition = {
  index: number;
  elapsedMs: number;
  remainingMs: number;
  cycleMs: number;
};

const MIN_DURATION_MS = 2_000;
const MAX_DURATION_MS = 300_000;
const DEFAULT_IMAGE_MS = 8_000;
const DEFAULT_VIDEO_MS = 10_000;

export function adEntryDurationMs(entry: TimedAdEntry): number {
  const rawSeconds = entry.item.mediaType === "video"
    ? Number(entry.item.mediaDurationSeconds) || DEFAULT_VIDEO_MS / 1_000
    : Number(entry.item.imageDurationSeconds) || DEFAULT_IMAGE_MS / 1_000;
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(rawSeconds * 1_000)));
}

export function resolveAdSyncPosition(
  entries: TimedAdEntry[],
  sharedNowMs: number,
  epochMs = 0,
): AdSyncPosition | null {
  if (!entries.length) return null;
  const durations = entries.map(adEntryDurationMs);
  const cycleMs = durations.reduce((sum, value) => sum + value, 0);
  if (cycleMs <= 0) return null;

  const rawPhase = (sharedNowMs - epochMs) % cycleMs;
  const phaseMs = rawPhase < 0 ? rawPhase + cycleMs : rawPhase;
  let cursor = 0;
  for (let index = 0; index < durations.length; index += 1) {
    const duration = durations[index];
    if (phaseMs < cursor + duration) {
      const elapsedMs = phaseMs - cursor;
      return {
        index,
        elapsedMs,
        remainingMs: Math.max(1, duration - elapsedMs),
        cycleMs,
      };
    }
    cursor += duration;
  }

  return { index: 0, elapsedMs: 0, remainingMs: durations[0], cycleMs };
}

export function estimateServerClockOffsetMs(
  serverNowMs: number,
  requestStartedMs: number,
  responseReceivedMs: number,
): number {
  if (![serverNowMs, requestStartedMs, responseReceivedMs].every(Number.isFinite)) return 0;
  const midpoint = requestStartedMs + Math.max(0, responseReceivedMs - requestStartedMs) / 2;
  return Math.round(serverNowMs - midpoint);
}
