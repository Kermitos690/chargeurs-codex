import { useCallback, useEffect, useState } from "react";
import { KioskAdvertisingLayer } from "./KioskAdvertisingLayer";
import { KioskAdvertisingPartnerBridge } from "./KioskAdvertisingPartnerBridge";
import { KioskAdvertisingPortraitFocus } from "./KioskAdvertisingPortraitFocus";
import { invokeKioskEdgeProxy } from "@/lib/kioskEdgeProxy";
import {
  estimateNetworkClockSample,
  selectStableClockOffsetMs,
  getAuthoritativeAdsClockOffsetMs,
  setAuthoritativeAdsClockOffsetMs,
  type NetworkClockSample,
} from "@/lib/adSync";

const SYNC_HEARTBEAT_MS = 1_000;
const CLOCK_RESYNC_MS = 10 * 60_000;
const INITIAL_CLOCK_SAMPLES = 3;
const STEADY_CLOCK_SAMPLES = 1;
const SAMPLE_GAP_MS = 70;
const RESUME_RESYNC_MIN_GAP_MS = 60_000;
const ADS_CACHE_PREFIX = "chargeurs:ads:playlist:clock-v2:";

type AdsClockResponse = {
  ok?: boolean;
  serverReceiveMs?: number;
  serverSendMs?: number;
  timelineEpochMs?: number;
};

const warmedImages = new Map<string, HTMLImageElement>();

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function warmCachedAdvertisingMedia() {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(ADS_CACHE_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { campaigns?: Array<{ items?: Array<{ mediaType?: string; url?: string }> }> };
      for (const campaign of parsed.campaigns ?? []) {
        for (const item of campaign.items ?? []) {
          const url = typeof item.url === "string" ? item.url : "";
          if (item.mediaType !== "image" || !url || warmedImages.has(url)) continue;
          const image = new Image();
          image.decoding = "async";
          image.src = url;
          warmedImages.set(url, image);
          image.onload = () => {
            if (typeof image.decode === "function") void image.decode().catch(() => undefined);
          };
          image.onerror = () => warmedImages.delete(url);
          if (image.complete && image.naturalWidth > 0 && typeof image.decode === "function") {
            void image.decode().catch(() => undefined);
          }
        }
      }
    }
  } catch {
    // Media warm-up is opportunistic and must never affect kiosk operation.
  }
}

/**
 * Keeps the isolated Ads runtime on a shared network cadence while respecting
 * the Supabase Free-plan invocation budget. The last good clock offset remains
 * authoritative between sparse resyncs; ad boundaries themselves are still
 * calculated locally from the shared timeline epoch.
 *
 * Partner QR/data and portrait smart-crop helpers are mounted only inside this
 * Advertising runtime. Either helper may fail closed without propagating to the
 * kiosk product shell.
 *
 * This wrapper owns no rental, payment, return, inventory or hardware state.
 */
export function KioskAdvertisingSynchronizedLayer() {
  const [, setHeartbeat] = useState(0);
  const [authoritativeClockOffsetMs, setAuthoritativeClockOffsetMs] = useState<number | null>(
    () => getAuthoritativeAdsClockOffsetMs(),
  );

  const synchronizeClock = useCallback(async (sampleCount: number) => {
    const samples: NetworkClockSample[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const clientSendMs = Date.now();
      try {
        const { data, transportError } = await invokeKioskEdgeProxy<AdsClockResponse>(
          "/api/kiosk/ads-clock",
          {},
          {},
        );
        const clientReceiveMs = Date.now();
        if (!transportError && data?.ok) {
          const sample = estimateNetworkClockSample(
            clientSendMs,
            Number(data.serverReceiveMs),
            Number(data.serverSendMs),
            clientReceiveMs,
          );
          if (sample && sample.rttMs <= 3_000) samples.push(sample);
        }
      } catch {
        // Keep the last good clock. Ads remain fail-safe/offline-capable.
      }
      if (index + 1 < sampleCount) await sleep(SAMPLE_GAP_MS);
    }

    const stableOffsetMs = selectStableClockOffsetMs(samples);
    if (stableOffsetMs !== null) {
      setAuthoritativeAdsClockOffsetMs(stableOffsetMs);
      setAuthoritativeClockOffsetMs(stableOffsetMs);
      const bestRtt = samples.length ? Math.min(...samples.map((sample) => sample.rttMs)) : 0;
      document.documentElement.dataset.kioskAdsClock = "locked";
      document.documentElement.dataset.kioskAdsClockRttMs = String(bestRtt);
      document.documentElement.dataset.kioskAdsClockOffsetMs = String(stableOffsetMs);
      setHeartbeat((value) => (value + 1) % 10_000);
    }
    warmCachedAdvertisingMedia();
  }, []);

  useEffect(() => {
    let lastResumeResyncAt = 0;
    const pulse = () => setHeartbeat((value) => (value + 1) % 10_000);
    const heartbeat = window.setInterval(pulse, SYNC_HEARTBEAT_MS);
    void synchronizeClock(INITIAL_CLOCK_SAMPLES);
    const clockTimer = window.setInterval(() => void synchronizeClock(STEADY_CLOCK_SAMPLES), CLOCK_RESYNC_MS);
    const warmTimer = window.setInterval(warmCachedAdvertisingMedia, 60_000);
    warmCachedAdvertisingMedia();

    const resync = () => {
      pulse();
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastResumeResyncAt < RESUME_RESYNC_MIN_GAP_MS) return;
      lastResumeResyncAt = now;
      void synchronizeClock(STEADY_CLOCK_SAMPLES);
    };
    window.addEventListener("focus", resync);
    window.addEventListener("pageshow", resync);
    document.addEventListener("visibilitychange", resync);

    return () => {
      window.clearInterval(heartbeat);
      window.clearInterval(clockTimer);
      window.clearInterval(warmTimer);
      window.removeEventListener("focus", resync);
      window.removeEventListener("pageshow", resync);
      document.removeEventListener("visibilitychange", resync);
      delete document.documentElement.dataset.kioskAdsClock;
      delete document.documentElement.dataset.kioskAdsClockRttMs;
      delete document.documentElement.dataset.kioskAdsClockOffsetMs;
    };
  }, [synchronizeClock]);

  return (
    <>
      <KioskAdvertisingLayer authoritativeClockOffsetMs={authoritativeClockOffsetMs} />
      <KioskAdvertisingPartnerBridge />
      <KioskAdvertisingPortraitFocus />
    </>
  );
}