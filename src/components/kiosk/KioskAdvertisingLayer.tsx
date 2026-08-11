import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Megaphone, VolumeX, Zap } from "lucide-react";
import { readKioskToken } from "@/lib/kioskFetch";
import { invokeKioskEdgeProxy } from "@/lib/kioskEdgeProxy";
import { useI18n } from "@/i18n/i18n";
import "./kiosk-advertising.css";

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

const REFRESH_MS = 60_000;
const CACHE_PREFIX = "chargeurs:ads:playlist:";

function sceneNow(): string {
  return document.documentElement.dataset.kioskScene ?? (document.querySelector(".ck2-home") ? "home" : "other");
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
    // Cache is opportunistic. A full browser storage area must never break rent.
  }
}

async function reportImpression(stationId: string, entry: AdEntry, mode: DisplayMode, durationMs: number, completed: boolean) {
  const token = readKioskToken();
  if (!token || durationMs < 250) return;
  await invokeKioskEdgeProxy<PlaylistResponse>(
    "/api/kiosk/ads-playlist",
    {
      action: "impression",
      stationId,
      campaignId: entry.campaignId,
      assetId: entry.item.assetId,
      displayMode: mode,
      durationMs: Math.round(durationMs),
      completed,
    },
    { "X-Kiosk-Token": token },
  );
}

function useAdRotation(entries: AdEntry[], active: boolean, mode: DisplayMode, stationId: string) {
  const [index, setIndex] = useState(0);
  const completedRef = useRef(false);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (index < entries.length) return;
    setIndex(0);
  }, [entries.length, index]);

  const current = entries.length ? entries[index % entries.length] : null;

  const advance = useCallback(() => {
    if (!entries.length) return;
    completedRef.current = true;
    setIndex((value) => (value + 1) % entries.length);
  }, [entries.length]);

  useEffect(() => {
    if (!active || !current) return;
    completedRef.current = false;
    startedAtRef.current = Date.now();

    let timer: number | null = null;
    if (current.item.mediaType === "image") {
      const seconds = Math.min(300, Math.max(2, Number(current.item.imageDurationSeconds) || 8));
      timer = window.setTimeout(() => advance(), seconds * 1000);
    }

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      const duration = Math.max(0, Date.now() - startedAtRef.current);
      void reportImpression(stationId, current, mode, duration, completedRef.current);
    };
  }, [active, advance, current, mode, stationId]);

  useEffect(() => {
    if (!active || entries.length < 2) return;
    const next = entries[(index + 1) % entries.length];
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
  }, [active, entries, index]);

  return { current, advance };
}

function AdMedia({ entry, mode, onEnded }: { entry: AdEntry; mode: DisplayMode; onEnded: () => void }) {
  if (entry.item.mediaType === "video") {
    return (
      <video
        key={entry.key}
        className="kiosk-ad-media"
        src={entry.item.url}
        poster={entry.item.posterUrl ?? undefined}
        autoPlay
        muted
        playsInline
        preload="auto"
        aria-label={entry.item.title}
        onEnded={onEnded}
        onError={onEnded}
      />
    );
  }
  return <img key={entry.key} className="kiosk-ad-media" src={entry.item.url} alt={entry.item.title} draggable={false} />;
}

export function KioskAdvertisingLayer() {
  const { stationId = "" } = useParams();
  const { lang } = useI18n();
  const [playlist, setPlaylist] = useState<PlaylistResponse>(() => loadCached(stationId) ?? { ok: true, campaigns: [] });
  const [scene, setScene] = useState(() => sceneNow());
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
    const detect = () => setScene(sceneNow());
    detect();
    const htmlObserver = new MutationObserver(detect);
    htmlObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-kiosk-scene"] });
    const bodyObserver = new MutationObserver(detect);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
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
    if (scene !== "home" || saverEntries.length === 0) {
      setScreensaver(false);
      lastActivityRef.current = Date.now();
      return;
    }
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= idleAfterSeconds * 1000) setScreensaver(true);
    }, 500);
    return () => window.clearInterval(timer);
  }, [idleAfterSeconds, saverEntries.length, scene]);

  const splitActive = scene === "home" && !screensaver && splitEntries.length > 0;
  const saverActive = scene === "home" && screensaver && saverEntries.length > 0;
  const split = useAdRotation(splitEntries, splitActive, "split", stationId);
  const saver = useAdRotation(saverEntries, saverActive, "screensaver", stationId);

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
          <AdMedia entry={split.current} mode="split" onEnded={split.advance} />
          <div className="kiosk-ad-split-badge"><Megaphone /> {copy.sponsored}</div>
          {split.current.item.mediaType === "video" && <div className="kiosk-ad-muted"><VolumeX /> {copy.muted}</div>}
        </aside>
      )}

      {saverActive && saver.current && (
        <div className="kiosk-ad-screensaver" role="button" tabIndex={0} aria-label={copy.touch} onClick={markActivity} onKeyDown={markActivity}>
          <AdMedia entry={saver.current} mode="screensaver" onEnded={saver.advance} />
          <div className="kiosk-ad-screensaver-shade" aria-hidden />
          <div className="kiosk-ad-screensaver-brand"><Zap /> Chargeurs.ch</div>
          <div className="kiosk-ad-screensaver-cta"><span>{copy.touch}</span><b>→</b></div>
          <div className="kiosk-ad-screensaver-partner"><Megaphone /> {copy.sponsored}</div>
        </div>
      )}
    </>
  );
}
