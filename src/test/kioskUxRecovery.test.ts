/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildKioskProgressConfig,
  detectKioskReturnStage,
  detectKioskScene,
  type KioskScene,
} from "@/components/kiosk/KioskV3JourneyChrome";

function body(html: string) {
  document.body.innerHTML = html;
  document.documentElement.removeAttribute("data-kiosk-scene");
}

beforeEach(() => {
  body("");
});

describe("P1 kiosk scene detection", () => {
  it.each([
    ["loading", '<div class="ck2-shell ck2-loading"><svg class="lucide lucide-loader-circle"></svg></div>'],
    ["support", '<div class="ck2-home"></div><div class="kiosk-quarantine"></div>'],
    ["home", '<div class="ck2-home"></div>'],
    ["member", '<div class="ck2-member"></div>'],
    ["connected", '<div class="ck2-connected"></div>'],
    ["selection", '<div class="kiosk-idle-stage"></div>'],
    ["pricing", '<div class="kiosk-pricing-stage"></div>'],
    ["payment", '<div class="kiosk-qr-stage"></div>'],
    ["release", '<div class="kiosk-release-stage"></div>'],
    ["active", '<div class="kiosk-ready-stage"></div>'],
  ] satisfies Array<[KioskScene, string]>)('detects %s', (scene, markup) => {
    body(markup);
    expect(detectKioskScene()).toBe(scene);
  });

  it("does not mistake the hidden timeout ownership marker for release", () => {
    body('<div class="kiosk-release-stage" data-kiosk-timeout-owner="inner" hidden></div>');
    expect(detectKioskScene()).toBe("other");
  });

  it("detects the starting handoff instead of dropping progress", () => {
    body('<div class="kiosk-root"><main><div><svg class="lucide lucide-loader-circle"></svg><p class="text-3xl">Préparation</p></div></main></div>');
    expect(detectKioskScene()).toBe("starting");
  });

  it("detects QR expiry", () => {
    body('<div class="kiosk-root"><main><div><svg class="lucide lucide-clock"></svg><button><svg class="lucide lucide-refresh-cw"></svg></button></div></main></div>');
    expect(detectKioskScene()).toBe("expired");
  });

  it("distinguishes error from support", () => {
    body('<div class="kiosk-root"><main><div><div class="bg-destructive/20"><svg class="lucide lucide-alert-triangle"></svg></div></div></main></div>');
    expect(detectKioskScene()).toBe("error");

    body('<div class="kiosk-root"><main><div><div class="bg-warning/20"><svg class="lucide lucide-alert-triangle"></svg></div></div></main></div>');
    expect(detectKioskScene()).toBe("support");
  });

  it("prioritizes a return overlay over the underlying journey", () => {
    body('<div class="kiosk-idle-stage"></div><div class="fixed inset-0 z-[120]"><svg class="lucide lucide-receipt-text"></svg></div>');
    expect(detectKioskScene()).toBe("return");
  });
});

describe("return presentation stage detection", () => {
  it("detects settling", () => {
    const overlay = document.createElement("div");
    overlay.innerHTML = '<svg class="lucide lucide-receipt-text"></svg>';
    expect(detectKioskReturnStage(overlay)).toBe("settling");
  });

  it("detects support", () => {
    const overlay = document.createElement("div");
    overlay.innerHTML = '<div class="text-warning"></div>';
    expect(detectKioskReturnStage(overlay)).toBe("support");
  });

  it("detects completed", () => {
    const overlay = document.createElement("div");
    overlay.innerHTML = '<div class="text-success"></div>';
    expect(detectKioskReturnStage(overlay)).toBe("completed");
  });
});

describe("journey progress contract", () => {
  it.each([
    ["selection", 1],
    ["pricing", 1],
    ["starting", 2],
    ["payment", 2],
    ["release", 3],
    ["active", 4],
    ["return", 5],
  ] satisfies Array<[KioskScene, number]>)('maps Express %s to step %i', (scene, active) => {
    expect(buildKioskProgressConfig(scene, "express", "fr").active).toBe(active);
  });

  it.each([
    ["member", 1],
    ["connected", 1],
    ["selection", 2],
    ["pricing", 2],
    ["starting", 3],
    ["payment", 3],
    ["release", 4],
    ["active", 4],
    ["return", 5],
  ] satisfies Array<[KioskScene, number]>)('maps Client %s to step %i', (scene, active) => {
    expect(buildKioskProgressConfig(scene, "client", "fr").active).toBe(active);
  });

  it.each(["expired", "error", "support"] satisfies KioskScene[])(
    "keeps payment position visible through %s",
    (transient) => {
      expect(buildKioskProgressConfig(transient, "express", "fr", "payment").active).toBe(2);
      expect(buildKioskProgressConfig(transient, "client", "fr", "payment").active).toBe(3);
    },
  );

  it("keeps Express and Client color/journey identity independent", () => {
    const express = buildKioskProgressConfig("release", "express", "fr");
    const client = buildKioskProgressConfig("release", "client", "fr");
    expect(express.client).toBe(false);
    expect(client.client).toBe(true);
    expect(express.labels).toEqual(["CHOIX", "PAIEMENT", "DÉPART", "LOCATION", "RETOUR"]);
    expect(client.labels).toEqual(["CONNEXION", "SÉLECTION", "PAIEMENT", "RETIRER", "RETOUR"]);
  });
});
