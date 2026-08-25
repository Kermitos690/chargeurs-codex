// Deploy marker: force Vercel to publish the merged Ads ultra-sync runtime.
// Refresh marker: re-trigger production publish after Vercel build-rate-limit cleared.
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

export type NetworkClockSample = {
  offsetMs: number;
  rttMs: number;
};

const MIN_DURATION_MS = 2_000;
const MAX_DURATION_MS = 300_000;
const DEFAULT_IMAGE_MS = 8_000;
const DEFAULT_VIDEO_MS = 10_000;

let authoritativeAdsClockOffsetMs: number | null = null;

export function setAuthoritativeAdsClockOffsetMs(offsetMs: number | null): void {
  authoritativeAdsClockOffsetMs = offsetMs !== null && Number.isFinite(offsetMs)
    ? Math.round(offsetMs)
    : null;
}

export function getAuthoritativeAdsClockOffsetMs(): number | null {
  return authoritativeAdsClockOffsetMs;
}

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

  // Once the dedicated fleet clock has a stable sample, it is authoritative for
  // every Ads render. This immediately corrects a kiosk even if its earlier
  // playlist request used a noisier RTT estimate.
  const effectiveSharedNowMs = authoritativeAdsClockOffsetMs !== null
    ? Date.now() + authoritativeAdsClockOffsetMs
    : sharedNowMs;

  const rawPhase = (effectiveSharedNowMs - epochMs) % cycleMs;
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
  if (authoritativeAdsClockOffsetMs !== null) return authoritativeAdsClockOffsetMs;
  if (![serverNowMs, requestStartedMs, responseReceivedMs].every(Number.isFinite)) return 0;

  // Playlist-clock fallback. The dedicated Ads clock below is preferred because
  // it measures server receive + send timestamps and filters transport jitter.
  const midpoint = requestStartedMs + Math.max(0, responseReceivedMs - requestStartedMs) / 2;
  return Math.round(serverNowMs - midpoint);
}

/**
 * NTP-style clock estimate using four timestamps:
 * t0 = client send, t1 = server receive, t2 = server send, t3 = client receive.
 * This removes server processing time from the RTT and estimates the wall-clock
 * offset without requiring the Android tablets' local clocks to agree.
 */
export function estimateNetworkClockSample(
  clientSendMs: number,
  serverReceiveMs: number,
  serverSendMs: number,
  clientReceiveMs: number,
): NetworkClockSample | null {
  if (![clientSendMs, serverReceiveMs, serverSendMs, clientReceiveMs].every(Number.isFinite)) return null;
  if (clientReceiveMs < clientSendMs || serverSendMs < serverReceiveMs) return null;

  const serverProcessingMs = serverSendMs - serverReceiveMs;
  const rttMs = Math.max(0, (clientReceiveMs - clientSendMs) - serverProcessingMs);
  const offsetMs = ((serverReceiveMs - clientSendMs) + (serverSendMs - clientReceiveMs)) / 2;
  return { offsetMs: Math.round(offsetMs), rttMs: Math.round(rttMs) };
}

/**
 * Pick a stable offset from the lowest-latency samples. High-RTT outliers are
 * discarded and the median of the best three prevents one asymmetric request
 * from shifting a kiosk away from the fleet timeline.
 */
export function selectStableClockOffsetMs(samples: NetworkClockSample[]): number | null {
  const valid = samples
    .filter((sample) => Number.isFinite(sample.offsetMs) && Number.isFinite(sample.rttMs) && sample.rttMs >= 0)
    .sort((a, b) => a.rttMs - b.rttMs)
    .slice(0, 3);
  if (!valid.length) return null;
  const offsets = valid.map((sample) => sample.offsetMs).sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

// Production deploy retry marker 1 — no runtime behavior change.
