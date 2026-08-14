import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Megaphone, VolumeX, Zap } from "lucide-react";
import { readKioskToken } from "@/lib/kioskFetch";
import { invokeKioskEdgeProxy } from "@/lib/kioskEdgeProxy";
import { useI18n } from "@/i18n/i18n";
import "./kiosk-advertising.css";
import "./kiosk-advertising-failsafe.css";

type AdItem = {
  id: string;
  assetId: string;
  title: string;
  mediaType: "image" | "video";
  mimeType: string;
  url: string;
  posterUrl?: string | null;
  imageDurationSeconds?: number | null;
  mediaDurationSeconds?: number | null;
  sortOrder: number;
};

type AdCampaign = {
  id: string;
  name: string;
  modes: Array<"split" | "screensaver">;
  idleAfterSeconds: number;
  splitRatio: number;
  priority: number;
  updatedAt: string;
  items: AdItem[];
};

type PlaylistResponse = {
  ok?: boolean;
  stationId?: string;
  version?: string;
  campaigns?: AdCampaign[];
  error?: string;
};

type AdEntry = {
  key: string;
  campaignId: string;
  campaignName: string;
  splitRatio: number;
  item: AdItem;
};

type DisplayMode = "split" | "screensaver";
type PlaybackStatus = "completed" | "failed" | "interrupted";

const REFRESH_MS = 60_000;
const CACHE_PREFIX = "chargeurs:ads:playlist:";

function sceneNow(): string {
  return document.documentElement.dataset.kioskScene ?? (document.querySelector(".ck2-home") ? "home" : "other");
}

function interactionOverlayOpen(): boolean {
  return Boolean(document.querySelector(
    '[role="dialog"][aria-modal="true"], .kiosk-offers-modal, .fixed.inset-0[class*="z-[120]"], .fixed.inset-0[class*="z-[250]"]',
  ));
}

function flattenCampaigns(campaigns: AdCampaign[], mode: DisplayMode): AdEntry[] {
  return campaigns.flatMap((campaign) => {
    if (!campaign.modes.includes(mode)) return [];
    return campaign.items.map((item) => ({
      key: `${campaign.id}:${item.id}`,
      campaignId: campaign.id,
      campaignName: campaign.name,
      splitRatio: Math.min(.5, Math.max(.2, Number(campaign.splitRatio) || .35)),
      item,
    }));
  });
}

function loadCached(stationId: string): PlaylistResponse | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${stationId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaylistResponse;
    return parsed?.ok && Array.isArray(parsed.campaigns) ? parsed : null;
  } catch {
    return null;
  }
}

function cachePlaylist(stationId: string, payload: PlaylistResponse) {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${stationId}`, JSON.stringify(payload));
  } catch {
    // Advertising cache is opportunistic. Storage pressure must never impact rentals.
  }
}

async function reportPlayback(
  stationId: string,
  entry: AdEntry,
  mode: DisplayMode,
  durationMs: number,
  started: boolean,
  playbackStatus: PlaybackStatus,
  playlistVersion?: string,
  errorCode?: string | null,
) {
  const token = readKioskToken();
  if (!token || !stationId) return;
  try {
    await invokeKioskEdgeProxy<PlaylistResponse>(
      "/api/kiosk/ads-playlist",
      {
        action: "impression",
        stationId,
        campaignId: entry.campaignId,
        assetId: entry.item.assetId,
        displayMode: mode,
        durationMs: Math.max(0, Math.round(durationMs)),
        started,
        playbackStatus,
        playlistVersion: playlistVersion ?? null,
        errorCode: errorCode ?? null,
      },
      { "X-Kiosk-Token": token },
    );
  } catch {
    // Analytics are best-effort. A telemetry outage must never affect kiosk UX.
  }
}

export function useAdRotation(entries: AdEntry[], active: boolean, mode: DisplayMode, stationId: string, playlistVersion?: string) {
  const [index, setIndex] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [blockedKeys, setBlockedKeys] = useState<Set<string>>(() => new Set());
  const startedRef = useRef(false);
  const startedAtRef = useRef(0);
  const statusRef = useRef<PlaybackStatus>("interrupted");
  const errorCodeRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const entriesSignature = useMemo(() => entries.map((entry) => entry.key).join("|"), [entries]);
  useEffect(() => {
    setBlockedKeys(new Set());
    setIndex(0);
    setEpoch(0);
  }, [entriesSignature, playlistVersion]);

  const availableEntries = useMemo(
    () => entries.filter((entry) => !blockedKeys.has(entry.key)),
    [blockedKeys, entries],
  );

  useEffect(() => {
    if (index < availableEntries.length) return;
    setIndex(0);
  }, [availableEntries.length, index]);

  const current = availableEntries.length ? availableEntries[index % availableEntries.length] : null;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const finish = useCallback((status: PlaybackStatus, errorCode?: string) => {
    if (!current) return;
    statusRef.current = status;
    errorCodeRef.current = errorCode ?? null;
    clearTimer();

    if (status === "failed") {
      setBlockedKeys((previous) => {
        const next = new Set(previous);
        next.add(current.key);
        return next;
      });
      return;
    }

    setIndex((value) => availableEntries.length ? (value + 1) % availableEntries.length : 0);
    // Forces a fresh media element even for a one-item playlist.
    setEpoch((value) => value + 1);
  }, [availableEntries.length, clearTimer, current]);

  const complete = useCallback(() => finish("completed"), [finish]);
  const fail = useCallback((errorCode: string) => finish("failed", errorCode), [finish]);

  const markStarted = useCallback(() => {
    if (!active || !current || startedRef.current) return;
    startedRef.current = true;
    startedAtRef.current = Date.now();
  }, [active, current]);

  useEffect(() => {
    if (!active || !current) return;
    clearTimer();
    startedRef.current = false;
    startedAtRef.current = 0;
    statusRef.current = "interrupted";
    errorCodeRef.current = null;

    // Rotation must not depend on an image load event. Some Android WebViews can
    // restore a cached image without reliably delivering React's onLoad after a
    // remount; tying the timer to onLoad leaves the screensaver frozen forever.
    // onLoad remains useful only to qualify the impression as actually started.
    if (current.item.mediaType === "image") {
      const seconds = Math.min(300, Math.max(2, Number(current.item.imageDurationSeconds) || 8));
      timerRef.current = window.setTimeout(complete, seconds * 1000);
    }

    return () => {
      clearTimer();
      const duration = startedRef.current ? Math.max(0, Date.now() - startedAtRef.current) : 0;
      void reportPlayback(
        stationId,
        current,
        mode,
        duration,
        startedRef.current,
        statusRef.current,
        playlistVersion,
        errorCodeRef.current,
      );
    };
  }, [active, clearTimer, complete, current, epoch, mode, playlistVersion, stationId]);

  useEffect(() => {
    if (!active || availableEntries.length < 2) return;
    const next = availableEntries[(index + 1) % availableEntries.length];
    if (!next?.item.url) return;
    if (next.item.mediaType === "image") {
      const img = new Image();
      img.decoding = "async";
      img.src = next.item.url;
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = next.item.url;
  }, [active, availableEntries, index]);

  return { current, epoch, complete, fail, markStarted };
}

function AdMedia({
  entry,
  epoch,
  onStarted,
  onCompleted,
  onFailed,
}: {
  entry: AdEntry;
  epoch: number;
  onStarted: () => void;
  onCompleted: () => void;
  onFailed: (errorCode: string) => void;
}) {
  if (entry.item.mediaType === "video") {
    return (
      <video
        key={`${entry.key}:${epoch}`}
        className="kiosk-ad-media"
        src={entry.item.url}
        poster={entry.item.posterUrl ?? undefined}
        autoPlay
        muted
        playsInline
        preload="auto"
        aria-label={entry.item.title}
        onPlaying={onStarted}
        onEnded={onCompleted}
        onError={() => onFailed("VIDEO_PLAYBACK_ERROR")}
      />
    );
  }
  return (
    <img
      key={`${entry.key}:${epoch}`}
      className="kiosk-ad-media"
      src={entry.item.url}
      alt={entry.item.title}
      draggable={false}
      onLoad={onStarted}
      onError={() => onFailed("IMAGE_LOAD_ERROR")}
    />
  );
}

function LocalBrandFallback() {
  return (
    <div className="kiosk-ad-local-brand" aria-label="Chargeurs.ch">
      <div className="kiosk-ad-local-brand-mark"><Zap /></div>
      <strong>Chargeurs.ch</strong>
      <span>Power when you need it.</span>
    </div>
  );
}

type BoundaryState = { failed: boolean };

class AdvertisingErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Chargeurs Ads disabled after isolated runtime error", error.message, info.componentStack);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function KioskAdvertisingRuntime() {
  const { stationId = "" } = useParams();
  const { lang } = useI18n();
  const [playlist, setPlaylist] = useState<PlaylistResponse>(() => loadCached(stationId) ?? { ok: true, campaigns: [] });
  const [scene, setScene] = useState(() => sceneNow());
  const [overlayOpen, setOverlayOpen] = useState(() => interactionOverlayOpen());
  const [screensaver, setScreensaver] = useState(false);
  const lastActivityRef = useRef(Date.now());

  const campaigns = playlist.campaigns ?? [];
  const splitEntries = useMemo(() => flattenCampaigns(campaigns, "split"), [campaigns]);
  const saverEntries = useMemo(() => flattenCampaigns(campaigns, "screensaver"), [campaigns]);
  const idleAfterSeconds = useMemo(() => {
    const values = campaigns.filter((campaign) => campaign.modes.includes("screensaver") && campaign.items.length > 0)
      .map((campaign) => Math.min(900, Math.max(10, Number(campaign.idleAfterSeconds) || 45)));
    return values.length ? Math.min(...values) : 45;
  }, [campaigns]);

  const load = useCallback(async () => {
    if (!stationId) return;
    const token = readKioskToken();
    if (!token) return;
    try {
      const { data, transportError } = await invokeKioskEdgeProxy<PlaylistResponse>(
        "/api/kiosk/ads-playlist",
        { action: "playlist", stationId },
        { "X-Kiosk-Token": token },
      );
      if (!transportError && data?.ok && Array.isArray(data.campaigns)) {
        setPlaylist(data);
        cachePlaylist(stationId, data);
        return;
      }
    } catch {
      // Network/backend Ads failure is isolated; retain the last valid local playlist.
    }
    const cached = loadCached(stationId);
    if (cached) setPlaylist(cached);
  }, [stationId]);

  useEffect(() => {
    const cached = loadCached(stationId);
    if (cached) setPlaylist(cached);
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load, stationId]);

  useEffect(() => {
    const detect = () => {
      setScene(sceneNow());
      setOverlayOpen(interactionOverlayOpen());
    };
    detect();
    const htmlObserver = new MutationObserver(detect);
    htmlObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-kiosk-scene"] });
    const bodyObserver = new MutationObserver(detect);
    bodyObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "role", "aria-modal"] });
    const timer = window.setInterval(detect, 750);
    return () => {
      htmlObserver.disconnect();
      bodyObserver.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setScreensaver(false);
  }, []);

  useEffect(() => {
    window.addEventListener("pointerdown", markActivity, { passive: true, capture: true });
    window.addEventListener("touchstart", markActivity, { passive: true, capture: true });
    window.addEventListener("keydown", markActivity, true);
    return () => {
      window.removeEventListener("pointerdown", markActivity, true);
      window.removeEventListener("touchstart", markActivity, true);
      window.removeEventListener("keydown", markActivity, true);
    };
  }, [markActivity]);

  useEffect(() => {
    if (scene !== "home" || overlayOpen || saverEntries.length === 0) {
      setScreensaver(false);
      lastActivityRef.current = Date.now();
      return;
    }
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= idleAfterSeconds * 1000) setScreensaver(true);
    }, 500);
    return () => window.clearInterval(timer);
  }, [idleAfterSeconds, overlayOpen, saverEntries.length, scene]);

  const safeHome = scene === "home" && !overlayOpen;
  const splitActive = safeHome && !screensaver && splitEntries.length > 0;
  const saverActive = safeHome && screensaver && saverEntries.length > 0;
  const split = useAdRotation(splitEntries, splitActive, "split", stationId, playlist.version);
  const saver = useAdRotation(saverEntries, saverActive, "screensaver", stationId, playlist.version);

  useEffect(() => {
    if (!splitActive || !split.current) return;
    document.documentElement.dataset.kioskAdsSplit = "true";
    document.documentElement.style.setProperty("--kiosk-ad-split-ratio", String(split.current.splitRatio));
    return () => {
      delete document.documentElement.dataset.kioskAdsSplit;
      document.documentElement.style.removeProperty("--kiosk-ad-split-ratio");
    };
  }, [split.current, splitActive]);

  const copy = lang === "de"
    ? { sponsored: "Partner", touch: "Bildschirm berühren, um eine Powerbank zu mieten", muted: "Video ohne Ton" }
    : lang === "en"
      ? { sponsored: "Partner", touch: "Touch the screen to rent a powerbank", muted: "Video muted" }
      : { sponsored: "Partenaire", touch: "Touchez l’écran pour louer une batterie", muted: "Vidéo sans son" };

  return (
    <>
      {splitActive && split.current && (
        <aside className="kiosk-ad-split" aria-label={`${copy.sponsored}: ${split.current.campaignName}`}>
          <AdMedia
            entry={split.current}
            epoch={split.epoch}
            onStarted={split.markStarted}
            onCompleted={split.complete}
            onFailed={split.fail}
          />
          <div className="kiosk-ad-split-badge"><Megaphone /> {copy.sponsored}</div>
          {split.current.item.mediaType === "video" && <div className="kiosk-ad-muted"><VolumeX /> {copy.muted}</div>}
        </aside>
      )}

      {saverActive && (
        <div className="kiosk-ad-screensaver" role="button" tabIndex={0} aria-label={copy.touch} onClick={markActivity} onKeyDown={markActivity}>
          {saver.current ? (
            <AdMedia
              entry={saver.current}
              epoch={saver.epoch}
              onStarted={saver.markStarted}
              onCompleted={saver.complete}
              onFailed={saver.fail}
            />
          ) : (
            <LocalBrandFallback />
          )}
          <div className="kiosk-ad-screensaver-shade" aria-hidden />
          <div className="kiosk-ad-screensaver-brand"><Zap /> Chargeurs.ch</div>
          <div className="kiosk-ad-screensaver-cta"><span>{copy.touch}</span><b>→</b></div>
          {saver.current && <div className="kiosk-ad-screensaver-partner"><Megaphone /> {copy.sponsored}</div>}
        </div>
      )}
    </>
  );
}

export function KioskAdvertisingLayer() {
  return (
    <AdvertisingErrorBoundary>
      <KioskAdvertisingRuntime />
    </AdvertisingErrorBoundary>
  );
}