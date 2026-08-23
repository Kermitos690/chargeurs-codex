export type AdFocalPoint = {
  x: number;
  y: number;
  source: "face" | "saliency" | "fallback";
};

const DEFAULT_FOCUS: AdFocalPoint = { x: 50, y: 50, source: "fallback" };
const focalCache = new Map<string, Promise<AdFocalPoint>>();

type FaceDetectorLike = {
  detect: (source: ImageBitmap) => Promise<Array<{ boundingBox?: DOMRectReadOnly }>>;
};

type FaceDetectorConstructor = new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "force-cache",
  });
  if (!response.ok) throw new Error(`AD_FOCAL_FETCH_${response.status}`);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

async function detectLargestFace(bitmap: ImageBitmap): Promise<AdFocalPoint | null> {
  try {
    const detectorCtor = (globalThis as typeof globalThis & { FaceDetector?: FaceDetectorConstructor }).FaceDetector;
    if (!detectorCtor) return null;
    const detector = new detectorCtor({ fastMode: true, maxDetectedFaces: 4 });
    const faces = await detector.detect(bitmap);
    let best: DOMRectReadOnly | null = null;
    let bestArea = 0;
    for (const face of faces) {
      const box = face.boundingBox;
      if (!box) continue;
      const area = Math.max(0, box.width) * Math.max(0, box.height);
      if (area > bestArea) {
        best = box;
        bestArea = area;
      }
    }
    if (!best || bestArea < bitmap.width * bitmap.height * 0.008) return null;
    return {
      x: clamp(((best.x + best.width / 2) / bitmap.width) * 100, 18, 82),
      y: clamp(((best.y + best.height / 2) / bitmap.height) * 100, 18, 82),
      source: "face",
    };
  } catch {
    return null;
  }
}

function saliencyFocus(bitmap: ImageBitmap): AdFocalPoint {
  const maxSide = 112;
  const ratio = bitmap.width / Math.max(1, bitmap.height);
  const width = ratio >= 1
    ? maxSide
    : Math.max(48, Math.round(maxSide * ratio));
  const height = ratio >= 1
    ? Math.max(48, Math.round(maxSide / ratio))
    : maxSide;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return DEFAULT_FOCUS;
  context.drawImage(bitmap, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;

  const luminance = new Float32Array(width * height);
  const saturation = new Float32Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    luminance[index] = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const maxChannel = Math.max(red, green, blue);
    const minChannel = Math.min(red, green, blue);
    saturation[index] = maxChannel - minChannel;
  }

  const gridColumns = 9;
  const gridRows = 7;
  const scores = new Float32Array(gridColumns * gridRows);
  const counts = new Uint16Array(gridColumns * gridRows);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const center = luminance[index];
      const left = luminance[index - 1];
      const right = luminance[index + 1];
      const up = luminance[index - width];
      const down = luminance[index + width];
      const gradient = Math.abs(right - left) + Math.abs(down - up);
      const neighborhood = (left + right + up + down) / 4;
      const contrast = Math.abs(center - neighborhood);
      const chroma = saturation[index];

      const normalizedX = x / Math.max(1, width - 1);
      const normalizedY = y / Math.max(1, height - 1);
      const centerDistance = Math.hypot(normalizedX - 0.5, normalizedY - 0.5) / Math.SQRT1_2;
      const centerPrior = 1 - 0.22 * clamp(centerDistance, 0, 1);
      const edgePenalty = normalizedX < 0.06 || normalizedX > 0.94 || normalizedY < 0.06 || normalizedY > 0.94 ? 0.72 : 1;
      const pixelScore = (gradient * 1.15 + contrast * 0.78 + chroma * 0.24) * centerPrior * edgePenalty;

      const gridX = Math.min(gridColumns - 1, Math.floor(normalizedX * gridColumns));
      const gridY = Math.min(gridRows - 1, Math.floor(normalizedY * gridRows));
      const gridIndex = gridY * gridColumns + gridX;
      scores[gridIndex] += pixelScore;
      counts[gridIndex] += 1;
    }
  }

  const blurred = new Float32Array(scores.length);
  for (let gridY = 0; gridY < gridRows; gridY += 1) {
    for (let gridX = 0; gridX < gridColumns; gridX += 1) {
      let total = 0;
      let weightTotal = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = gridX + dx;
          const y = gridY + dy;
          if (x < 0 || x >= gridColumns || y < 0 || y >= gridRows) continue;
          const sourceIndex = y * gridColumns + x;
          const average = counts[sourceIndex] ? scores[sourceIndex] / counts[sourceIndex] : 0;
          const weight = dx === 0 && dy === 0 ? 2 : 1;
          total += average * weight;
          weightTotal += weight;
        }
      }
      blurred[gridY * gridColumns + gridX] = weightTotal ? total / weightTotal : 0;
    }
  }

  let bestIndex = Math.floor(gridRows / 2) * gridColumns + Math.floor(gridColumns / 2);
  let bestScore = -1;
  for (let index = 0; index < blurred.length; index += 1) {
    if (blurred[index] > bestScore) {
      bestScore = blurred[index];
      bestIndex = index;
    }
  }

  const bestX = bestIndex % gridColumns;
  const bestY = Math.floor(bestIndex / gridColumns);
  return {
    x: clamp(((bestX + 0.5) / gridColumns) * 100, 18, 82),
    y: clamp(((bestY + 0.5) / gridRows) * 100, 18, 82),
    source: "saliency",
  };
}

async function estimate(url: string): Promise<AdFocalPoint> {
  if (!url || typeof window === "undefined" || typeof createImageBitmap !== "function") return DEFAULT_FOCUS;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await loadBitmap(url);
    const face = await detectLargestFace(bitmap);
    if (face) return face;
    return saliencyFocus(bitmap);
  } catch {
    return DEFAULT_FOCUS;
  } finally {
    bitmap?.close?.();
  }
}

export function estimateAdFocalPoint(url: string): Promise<AdFocalPoint> {
  const cached = focalCache.get(url);
  if (cached) return cached;
  const promise = estimate(url);
  focalCache.set(url, promise);
  return promise;
}
