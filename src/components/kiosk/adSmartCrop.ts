export type AdFocalPoint = { x: number; y: number };

const DEFAULT_FOCAL_POINT: AdFocalPoint = { x: 50, y: 46 };
const focalCache = new Map<string, AdFocalPoint>();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Lightweight, local-only saliency crop for the Home partner rail.
 *
 * It downsamples an image to a tiny canvas, scores edges + local contrast +
 * saturation, then chooses the highest-information crop matching the portrait
 * Home rail (4:5). No remote AI/service is involved. Any CORS/canvas failure
 * returns a safe centered focal point and never affects the kiosk runtime.
 */
export async function detectAdFocalPoint(imageUrl: string, targetAspect = 4 / 5): Promise<AdFocalPoint> {
  const cached = focalCache.get(imageUrl);
  if (cached) return cached;

  if (!imageUrl || typeof document === "undefined") return DEFAULT_FOCAL_POINT;

  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";

    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
    });

    image.src = imageUrl;
    if (!(image.complete && image.naturalWidth > 0)) await loaded;
    if (typeof image.decode === "function") await image.decode().catch(() => undefined);

    const sourceWidth = Math.max(1, image.naturalWidth);
    const sourceHeight = Math.max(1, image.naturalHeight);
    const maxSide = 96;
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(24, Math.round(sourceWidth * scale));
    const height = Math.max(24, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return DEFAULT_FOCAL_POINT;
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;

    const luminance = new Float32Array(width * height);
    const saturation = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const pixel = index * 4;
        const r = pixels[pixel] / 255;
        const g = pixels[pixel + 1] / 255;
        const b = pixels[pixel + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        luminance[index] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        saturation[index] = max > 0 ? (max - min) / max : 0;
      }
    }

    const saliency = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const horizontal = Math.abs(luminance[index + 1] - luminance[index - 1]);
        const vertical = Math.abs(luminance[index + width] - luminance[index - width]);
        const localContrast = Math.abs(luminance[index] - (
          luminance[index - 1] + luminance[index + 1] + luminance[index - width] + luminance[index + width]
        ) / 4);
        saliency[index] = horizontal * 1.4 + vertical * 1.4 + localContrast * 1.1 + saturation[index] * 0.16;
      }
    }

    const sourceAspect = width / height;
    let cropWidth = width;
    let cropHeight = height;
    if (sourceAspect > targetAspect) cropWidth = Math.max(1, Math.round(height * targetAspect));
    else cropHeight = Math.max(1, Math.round(width / targetAspect));

    const xRange = Math.max(0, width - cropWidth);
    const yRange = Math.max(0, height - cropHeight);
    const xSteps = xRange > 0 ? Math.min(24, xRange + 1) : 1;
    const ySteps = yRange > 0 ? Math.min(24, yRange + 1) : 1;

    let bestScore = -Infinity;
    let bestCenterX = width / 2;
    let bestCenterY = height / 2;

    for (let yi = 0; yi < ySteps; yi += 1) {
      const top = ySteps === 1 ? 0 : Math.round((yi / (ySteps - 1)) * yRange);
      for (let xi = 0; xi < xSteps; xi += 1) {
        const left = xSteps === 1 ? 0 : Math.round((xi / (xSteps - 1)) * xRange);
        const centerX = left + cropWidth / 2;
        const centerY = top + cropHeight / 2;
        let score = 0;
        let samples = 0;

        for (let y = top; y < top + cropHeight; y += 2) {
          for (let x = left; x < left + cropWidth; x += 2) {
            const dx = (x - centerX) / Math.max(1, cropWidth / 2);
            const dy = (y - centerY) / Math.max(1, cropHeight / 2);
            const subjectWeight = 1.18 - 0.26 * Math.min(1, dx * dx + dy * dy);
            score += saliency[y * width + x] * subjectWeight;
            samples += 1;
          }
        }

        score /= Math.max(1, samples);
        // Gentle center prior prevents unstable jumps to tiny edge details while
        // still allowing a clearly stronger off-centre product to win.
        const centerDistance = Math.abs(centerX / width - 0.5) + Math.abs(centerY / height - 0.5);
        score -= centerDistance * 0.025;

        if (score > bestScore) {
          bestScore = score;
          bestCenterX = centerX;
          bestCenterY = centerY;
        }
      }
    }

    const focal = {
      x: clamp((bestCenterX / width) * 100, 18, 82),
      y: clamp((bestCenterY / height) * 100, 16, 84),
    };
    focalCache.set(imageUrl, focal);
    return focal;
  } catch {
    return DEFAULT_FOCAL_POINT;
  }
}
