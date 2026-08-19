import { useEffect } from "react";
import "./kiosk-advertising-portrait-focus.css";

const ADS_CACHE_PREFIX = "chargeurs:ads:playlist:";
const SAMPLE_SIZE = 56;
const FALLBACK_FOCUS = { x: 50, y: 45 } as const;

type FocusPoint = { x: number; y: number };

const focusCache = new Map<string, FocusPoint>();
const focusInflight = new Map<string, Promise<FocusPoint>>();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function analyseVisualFocus(image: HTMLImageElement): FocusPoint {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return FALLBACK_FOCUS;

  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  const luminance = new Float32Array(SAMPLE_SIZE * SAMPLE_SIZE);
  const saturation = new Float32Array(SAMPLE_SIZE * SAMPLE_SIZE);

  for (let index = 0; index < SAMPLE_SIZE * SAMPLE_SIZE; index += 1) {
    const offset = index * 4;
    const r = pixels[offset] / 255;
    const g = pixels[offset + 1] / 255;
    const b = pixels[offset + 2] / 255;
    luminance[index] = .2126 * r + .7152 * g + .0722 * b;
    saturation[index] = Math.max(r, g, b) - Math.min(r, g, b);
  }

  let weightTotal = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let y = 1; y < SAMPLE_SIZE - 1; y += 1) {
    for (let x = 1; x < SAMPLE_SIZE - 1; x += 1) {
      const index = y * SAMPLE_SIZE + x;
      const horizontalEdge = Math.abs(luminance[index + 1] - luminance[index - 1]);
      const verticalEdge = Math.abs(luminance[index + SAMPLE_SIZE] - luminance[index - SAMPLE_SIZE]);
      const edge = horizontalEdge + verticalEdge;

      const nx = x / (SAMPLE_SIZE - 1);
      const ny = y / (SAMPLE_SIZE - 1);
      const centerDistance = Math.sqrt(Math.pow(nx - .5, 2) + Math.pow(ny - .47, 2)) / .72;
      const centerBias = .72 + .28 * (1 - clamp(centerDistance, 0, 1));
      const borderPenalty = nx < .08 || nx > .92 || ny < .07 || ny > .93 ? .62 : 1;
      const score = (edge * 2.7 + saturation[index] * .42 + .018) * centerBias * borderPenalty;
      const weight = score * score;

      weightTotal += weight;
      weightedX += x * weight;
      weightedY += y * weight;
    }
  }

  if (!Number.isFinite(weightTotal) || weightTotal <= 0) return FALLBACK_FOCUS;

  return {
    x: clamp((weightedX / weightTotal) / (SAMPLE_SIZE - 1) * 100, 18, 82),
    y: clamp((weightedY / weightTotal) / (SAMPLE_SIZE - 1) * 100, 18, 82),
  };
}

function estimateVisualFocus(url: string): Promise<FocusPoint> {
  const cached = focusCache.get(url);
  if (cached) return Promise.resolve(cached);

  const pending = focusInflight.get(url);
  if (pending) return pending;

  const request = new Promise<FocusPoint>((resolve) => {
    const probe = new Image();
    probe.decoding = "async";
    probe.crossOrigin = "anonymous";

    const finish = (point: FocusPoint) => {
      focusCache.set(url, point);
      focusInflight.delete(url);
      resolve(point);
    };

    probe.onload = () => {
      try {
        finish(analyseVisualFocus(probe));
      } catch {
        finish(FALLBACK_FOCUS);
      }
    };
    probe.onerror = () => finish(FALLBACK_FOCUS);
    probe.src = url;
  });

  focusInflight.set(url, request);
  return request;
}

function warmPlaylistFocus() {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(ADS_CACHE_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { campaigns?: Array<{ items?: Array<{ mediaType?: string; url?: string }> }> };
      for (const campaign of parsed.campaigns ?? []) {
        for (const item of campaign.items ?? []) {
          if (item.mediaType === "image" && typeof item.url === "string" && item.url) {
            void estimateVisualFocus(item.url);
          }
        }
      }
    }
  } catch {
    // Smart crop is visual-only. Any cache/analysis failure falls back to center.
  }
}

function applyPortraitFocus(media: HTMLImageElement) {
  try {
    const url = media.currentSrc || media.src || "";
    if (!url || media.dataset.smartFocusSource === url) return;

    media.dataset.smartFocusSource = url;
    media.dataset.smartFocus = "pending";
    media.style.setProperty("--kiosk-ad-focus-x", `${FALLBACK_FOCUS.x}%`);
    media.style.setProperty("--kiosk-ad-focus-y", `${FALLBACK_FOCUS.y}%`);

    void estimateVisualFocus(url).then((focus) => {
      try {
        if (!media.isConnected) return;
        const currentUrl = media.currentSrc || media.src || "";
        if (currentUrl !== url) return;
        media.style.setProperty("--kiosk-ad-focus-x", `${focus.x.toFixed(1)}%`);
        media.style.setProperty("--kiosk-ad-focus-y", `${focus.y.toFixed(1)}%`);
        media.dataset.smartFocus = focus.x === FALLBACK_FOCUS.x && focus.y === FALLBACK_FOCUS.y ? "fallback" : "saliency";
      } catch {
        // Fail closed to the CSS center fallback.
      }
    });
  } catch {
    // Never let smart cropping affect the Advertising runtime or kiosk shell.
  }
}

/**
 * Home split Ads are a portrait surface. This visual-only helper derives a
 * saliency-weighted focal point from each image and applies it to object-position
 * while CSS performs a full-bleed portrait crop. It owns no campaign, QR,
 * impression, rental, payment or hardware state.
 */
export function KioskAdvertisingPortraitFocus() {
  useEffect(() => {
    let disposed = false;

    const scan = () => {
      if (disposed) return;
      try {
        document
          .querySelectorAll<HTMLImageElement>(".kiosk-ad-split img.kiosk-ad-media")
          .forEach((media) => applyPortraitFocus(media));
      } catch {
        // Smart crop remains optional/fail-safe.
      }
    };

    warmPlaylistFocus();
    scan();

    const observer = new MutationObserver(() => scan());
    try {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "class"],
      });
    } catch {
      // The kiosk remains usable without automatic crop analysis.
    }

    const timer = window.setInterval(scan, 800);
    return () => {
      disposed = true;
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
