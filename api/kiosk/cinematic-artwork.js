import { readFileSync } from "node:fs";

const artworkFile = new URL("../../src/pages/chargeurs-cinematic-home.b64", import.meta.url);

export default function handler(_request, response) {
  try {
    const raw = readFileSync(artworkFile, "utf8").replace(/\s+/g, "");
    const bytes = Buffer.from(raw, "base64");

    if (bytes.length < 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error("INVALID_CINEMATIC_JPEG");
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", "image/jpeg");
    response.setHeader("Content-Length", String(bytes.length));
    response.setHeader("Cache-Control", "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(bytes);
  } catch (error) {
    console.error("CINEMATIC_ARTWORK_SERVE_FAILED", error);
    response.statusCode = 500;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ ok: false, error: "CINEMATIC_ARTWORK_UNAVAILABLE" }));
  }
}
