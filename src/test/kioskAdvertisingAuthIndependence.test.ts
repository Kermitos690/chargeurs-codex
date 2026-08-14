import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adsPlaylistHeaders,
  resolveAdvertisingSurface,
} from "@/components/kiosk/KioskAdvertisingLayer";

describe("paid advertising availability when rental auth is unavailable", () => {
  it("requests the read-only playlist even without a rental kiosk token", () => {
    expect(adsPlaylistHeaders(null)).toEqual({});
    expect(adsPlaylistHeaders("")).toEqual({});
    expect(adsPlaylistHeaders("station-secret")).toEqual({ "X-Kiosk-Token": "station-secret" });
  });

  it("prefers a fullscreen paid campaign immediately when rental auth is required", () => {
    expect(resolveAdvertisingSurface({
      authRequired: true,
      scene: "other",
      overlayOpen: false,
      screensaver: false,
      splitCount: 4,
      saverCount: 4,
    })).toEqual({ splitActive: false, saverActive: true });
  });

  it("keeps a split campaign visible beside the auth guard when no fullscreen campaign exists", () => {
    expect(resolveAdvertisingSurface({
      authRequired: true,
      scene: "other",
      overlayOpen: false,
      screensaver: false,
      splitCount: 4,
      saverCount: 0,
    })).toEqual({ splitActive: true, saverActive: false });
  });

  it("preserves normal home-only advertising rules when rental auth is healthy", () => {
    expect(resolveAdvertisingSurface({
      authRequired: false,
      scene: "payment",
      overlayOpen: false,
      screensaver: true,
      splitCount: 4,
      saverCount: 4,
    })).toEqual({ splitActive: false, saverActive: false });
  });

  it("keeps the backend playlist read-only while impression writes still require kiosk authentication", () => {
    const source = readFileSync(
      resolve(process.cwd(), "supabase/functions/kiosk-ads-playlist/index.ts"),
      "utf8",
    );

    const impressionBranch = source.indexOf('if (action === "impression")');
    const kioskVerification = source.indexOf("await verifyKioskDevice(req, db, stationId)");
    const stationRead = source.indexOf('.from("stations")');
    const verificationCount = source.match(/verifyKioskDevice\(req, db, stationId\)/g)?.length ?? 0;

    expect(impressionBranch).toBeGreaterThan(-1);
    expect(kioskVerification).toBeGreaterThan(impressionBranch);
    expect(stationRead).toBeGreaterThan(kioskVerification);
    expect(verificationCount).toBe(1);
    expect(source).toContain('if (!station) return reply({ ok: false, error: "STATION_NOT_FOUND" }, 404)');
  });
});
