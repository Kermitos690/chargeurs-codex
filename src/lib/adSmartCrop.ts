export type AdFocalPoint = { x: number; y: number };

const FALLBACK_FOCAL: AdFocalPoint = { x: 50, y: 46 };
const cache = new Map<string, Promise<AdFocalPoint>>();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function saturation(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min;
}

function luminance(r: number, g: number, b: number) {
  return .2126 * r + .7152 * g + .0722 * b;
}

function waitForImage(image: HTMLImageElement, timeoutMs = 2200) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    const timeout = window.setTimeout(() => finish(new Error("SMART_CROP_TIMEOUT")), timeoutMs);
    image.onload = () => finish();
    image.onerror = () => finish(new Error("SMART_CROP_IMAGE_ERROR"));
    if (image.complete && image.naturalWidth > 0) finish();
  });
}

async function analyze(url: string): Promise<AdFocalPoint> {
  if (typeof document === "undefined" || typeof Image === "undefined") return FALLBACK_FOCAL;

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  image.src = url;

  try {
    await waitForImage(image);
    if (typeof image.decode === "function") await image.decode().catch(() => undefined);

    const width = 72;
    const height = 72;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return FALLBACK_FOCAL;

    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const luma = new Float32Array(width * height);
    const chroma = new Float32Array(width * height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = (y * width + x) * 4;
        luma[y * width + x] = luminance(pixels[p], pixels[p + 1], pixels[p + 2]);
        chroma[y * width + x] = saturation(pixels[p], pixels[p + 1], pixels[p + 2]);
      }
    }

    const samples: Array<{ x: number; y: number; score: number }> = [];
    for (let y = 2; y < height - 2; y += 1) {
      for (let x = 2; x < width - 2; x += 1) {
        const index = y * width + x;
        const gx = Math.abs(luma[index + 1] - luma[index - 1]) + .5 * Math.abs(luma[index + 2] - luma[index - 2]);
        const gy = Math.abs(luma[index + width] - luma[index - width]) + .5 * Math.abs(luma[index + 2 * width] - luma[index - 2 * width]);
        const edge = gx + gy;
        const color = chroma[index];

        const nx = (x / (width - 1)) * 2 - 1;
        const ny = (y / (height - 1)) * 2 - 1;
        const distance = Math.sqrt(nx * nx + ny * ny);
        const centerBias = .72 + .28 * clamp(1 - distance, 0, 1);
        const upperBias = y < height * .78 ? 1 : .88;
        const score = (edge * 1.55 + color * .44) * centerBias * upperBias;
        samples.push({ x, y, score });
      }
    }

    samples.sort((a, b) => b.score - a.score);
    const take = Math.max(28, Math.floor(samples.length * .13));
    let total = 0;
    let weightedX = 0;
    let weightedY = 0;
    for (let i = 0; i < take; i += 1) {
      const sample = samples[i];
      const weight = Math.max(.001, sample.score);
      total += weight;
      weightedX += sample.x * weight;
      weightedY += sample.y * weight;
    }

    if (!Number.isFinite(total) || total <= 0) return FALLBACK_FOCAL;
    const x = clamp((weightedX / total / (width - 1)) * 100, 18, 82);
    const y = clamp((weightedY / total / (height - 1)) * 100, 16, 82);
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  } catch {
    // Cross-origin canvas restrictions, decode failures or older WebViews must
    // never affect Advertising availability. A centered portrait crop is safe.
    return FALLBACK_FOCAL;
  }
}

/**
 * Lightweight, dependency-free visual saliency heuristic used only to choose
 * `object-position` for the portrait Home advertising rail. It does not alter
 * source media and never participates in rental/payment/hardware state.
 */
export function resolveAdSmartFocalPoint(url: string): Promise<AdFocalPoint> {
  const key = url.trim();
  if (!key) return Promise.resolve(FALLBACK_FOCAL);
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = analyze(key).catch(() => FALLBACK_FOCAL);
  cache.set(key, pending);
  return pending;
}

export const AD_SMART_CROP_FALLBACK = FALLBACK_FOCAL;
