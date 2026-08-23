import fs from "node:fs";

const cssPath = "src/pages/kiosk-p0-selection-fit.css";
const scenePath = "src/components/kiosk/PowerbankScene.tsx";
const css = fs.readFileSync(cssPath, "utf8");
const scene = fs.readFileSync(scenePath, "utf8");

function fail(message) {
  console.error(`[kiosk-selection-readability] FAIL: ${message}`);
  process.exit(1);
}

function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m"));
  if (!match) fail(`missing CSS block: ${selector}`);
  return match[1];
}

function firstPx(text, property) {
  const match = text.match(new RegExp(`${property}\\s*:\\s*(?:clamp\\()?\\s*(\\d+(?:\\.\\d+)?)px`, "m"));
  if (!match) fail(`missing ${property} px value`);
  return Number(match[1]);
}

const stage = block('html.kiosk-v3[data-kiosk-scene="selection"] .kiosk-idle-stage');
const title = block('html.kiosk-v3[data-kiosk-scene="selection"] .kiosk-idle-hero h1');
const percentage = block('html.kiosk-v3[data-kiosk-scene="selection"] .kiosk-slot-card .text-5xl');
const status = block('html.kiosk-v3[data-kiosk-scene="selection"] .kiosk-slot-card .text-base');
const cta = block('html.kiosk-v3[data-kiosk-scene="selection"] .kiosk-idle-cta button');
const visual = block('html.kiosk-v3[data-kiosk-scene="selection"] .kiosk-slot-card .kiosk-slot-visual');

if (!stage.includes("1216px")) fail("selection stage must use the wide field layout (1216px cap)");
if (firstPx(title, "font-size") < 48) fail("selection title is too small for field use");
if (firstPx(percentage, "font-size") < 42) fail("battery percentage is too small for field use");
if (firstPx(status, "font-size") < 16) fail("slot status is too small for field use");
if (firstPx(cta, "font-size") < 20) fail("selection CTA text is too small for field use");
if (firstPx(cta, "min-height") < 64) fail("selection CTA touch target is too short");
if (firstPx(visual, "height") < 38) fail("battery status visual is too small");

const sceneStart = scene.indexOf("export function PowerbankScene");
const sceneEnd = scene.indexOf("export function KioskHolographicFloor");
if (sceneStart < 0 || sceneEnd <= sceneStart) fail("cannot isolate PowerbankScene implementation");
const selectionScene = scene.slice(sceneStart, sceneEnd);
if (/repeat\s*:\s*Infinity/.test(selectionScene)) fail("PowerbankScene must not loop animations on the selection screen");
if (/<motion\./.test(selectionScene) || /\banimate\s*=/.test(selectionScene)) fail("PowerbankScene must remain visually stable on the selection screen");

console.log("[kiosk-selection-readability] PASS");
console.log(JSON.stringify({
  stageWidthCap: 1216,
  titleMinPx: firstPx(title, "font-size"),
  percentageMinPx: firstPx(percentage, "font-size"),
  statusMinPx: firstPx(status, "font-size"),
  ctaMinPx: firstPx(cta, "font-size"),
  ctaMinHeightPx: firstPx(cta, "min-height"),
  visualHeightPx: firstPx(visual, "height"),
  selectionBatteryAnimations: "static",
}));
