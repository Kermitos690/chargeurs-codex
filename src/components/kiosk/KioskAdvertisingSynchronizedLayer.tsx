import { useCallback, useEffect, useState } from "react";
import { KioskAdvertisingLayer } from "./KioskAdvertisingLayer";
import { KioskAdvertisingPartnerBridge } from "./KioskAdvertisingPartnerBridge";
import { KioskAdvertisingPortraitFocus } from "./KioskAdvertisingPortraitFocus";
import { invokeKioskEdgeProxy } from "@/lib/kioskEdgeProxy";
import {
  estimateNetworkClockSample,
  selectStableClockOffsetMs,
  setAuthoritativeAdsClockOffsetMs,
  type NetworkClockSample,
} from "@/lib/adSync";

const SYNC_HEARTBEAT_MS = 50;
const CLOCK_RESYNC_MS = 15_000;
const INITIAL_CLOCK_SAMPLES = 5;
const STEADY_CLOCK_SAMPLES = 3;
const SAMPLE_GAP_MS = 35;
const ADS_CACHE_PREFIX = "chargeurs:ads:playlist:";

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
 * Keeps the isolated Ads runtime on a hard shared network cadence.
 *
 * A dedicated data-free clock endpoint is sampled with an NTP-style four
 * timestamp exchange. The median of the best low-latency samples becomes the
 * authoritative Ads clock for every kiosk, including a kiosk temporarily using
 * its cached playlist. Media are also warmed ahead of boundaries so Android
 * decode latency does not become visible as a one-second slide offset.
 *
 * The partner QR/data bridge and portrait focal crop are mounted inside the
 * isolated Advertising runtime. Either helper may fail closed without ever
 * propagating to the kiosk product shell.
 *
 * This wrapper owns no rental, payment, return, inventory or hardware state.
 */
export function KioskAdvertisingSynchronizedLayer() {
  const [, setHeartbeat] = useState(0);

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
      const bestRtt = samples.length ? Math.min(...samples.map((sample) => sample.rttMs)) : 0;
      document.documentElement.dataset.kioskAdsClock = "locked";
      document.documentElement.dataset.kioskAdsClockRttMs = String(bestRtt);
      document.documentElement.dataset.kioskAdsClockOffsetMs = String(stableOffsetMs);
      setHeartbeat((value) => (value + 1) % 10_000);
    }
    warmCachedAdvertisingMedia();
  }, []);

  useEffect(() => {
    const pulse = () => setHeartbeat((value) => (value + 1) % 10_000);
    const heartbeat = window.setInterval(pulse, SYNC_HEARTBEAT_MS);
    void synchronizeClock(INITIAL_CLOCK_SAMPLES);
    const clockTimer = window.setInterval(() => void synchronizeClock(STEADY_CLOCK_SAMPLES), CLOCK_RESYNC_MS);
    const warmTimer = window.setInterval(warmCachedAdvertisingMedia, 5_000);
    warmCachedAdvertisingMedia();

    const resync = () => {
      pulse();
      void synchronizeClock(INITIAL_CLOCK_SAMPLES);
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
      <KioskAdvertisingLayer />
      <KioskAdvertisingPartnerBridge />
      <KioskAdvertisingPortraitFocus />
    </>
  );
}
