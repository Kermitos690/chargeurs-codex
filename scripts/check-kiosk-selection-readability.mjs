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
const slotLabel = block('html.kiosk-v3[data-kiosk-scene="selection"] .kiosk-slot-card .text-xl');
const status = block('html.kiosk-v3[data-kiosk-scene="selection"] .kiosk-slot-card .text-base');
const cta = block('html.kiosk-v3[data-kiosk-scene="selection"] .kiosk-idle-cta button');
const visual = block('html.kiosk-v3[data-kiosk-scene="selection"] .kiosk-slot-card .kiosk-slot-visual');
const animatedStrip = block('html.kiosk-v3[data-kiosk-scene="selection"] .kiosk-slot-card .h-3.overflow-hidden');

if (!stage.includes("1140px")) fail("selection must use the balanced 1140px field layout");
if (firstPx(title, "font-size") < 46 || firstPx(title, "font-size") > 52) fail("selection title must stay aligned with the global kiosk hierarchy");
if (firstPx(percentage, "font-size") < 42 || firstPx(percentage, "font-size") > 50) fail("battery percentage must be readable without looking locally zoomed");
if (firstPx(slotLabel, "font-size") < 20) fail("slot label is too small for field use");
if (firstPx(status, "font-size") < 16) fail("slot status is too small for field use");
if (firstPx(cta, "font-size") < 21) fail("selection CTA text is too small for field use");
if (firstPx(cta, "min-height") < 68) fail("selection CTA touch target is too short");
if (firstPx(visual, "height") < 40) fail("battery status visual is too small");
if (!/display\s*:\s*none\s*!important/.test(animatedStrip)) fail("redundant JS width tween must stay hidden");

if (!css.includes("@keyframes kioskSelectedAura")) fail("premium selected-card aura is missing");
if (!css.includes("@keyframes kioskBatterySheen")) fail("premium battery sheen is missing");
if (/opacity\s*:\s*(0|\.\d+)/.test(css.match(/@keyframes kioskSelectedAura\s*\{([\s\S]*?)\n\}/)?.[1] ?? "")) fail("selected aura must not pulse opacity");
if (/scale\s*\(/.test(css.match(/@keyframes kioskSelectedAura\s*\{([\s\S]*?)\n\}/)?.[1] ?? "")) fail("selected aura must not zoom the card");

const sceneStart = scene.indexOf("export function PowerbankScene");
const sceneEnd = scene.indexOf("export function KioskHolographicFloor");
if (sceneStart < 0 || sceneEnd <= sceneStart) fail("cannot isolate PowerbankScene implementation");
const selectionScene = scene.slice(sceneStart, sceneEnd);
if (/repeat\s*:\s*Infinity/.test(selectionScene)) fail("React battery scene must not loop its own animations");
if (/<motion\./.test(selectionScene) || /\banimate\s*=/.test(selectionScene)) fail("React PowerbankScene must stay stable; ambient motion belongs to CSS only");

console.log("[kiosk-selection-readability] PASS");
console.log(JSON.stringify({
  stageWidthCap: 1140,
  stageHeightCap: 510,
  titleMinPx: firstPx(title, "font-size"),
  percentageMinPx: firstPx(percentage, "font-size"),
  slotLabelMinPx: firstPx(slotLabel, "font-size"),
  statusMinPx: firstPx(status, "font-size"),
  ctaMinPx: firstPx(cta, "font-size"),
  ctaMinHeightPx: firstPx(cta, "min-height"),
  visualHeightPx: firstPx(visual, "height"),
  premiumMotion: "slow-aura-plus-sheen",
  opacityPulse: false,
  scalePulse: false,
  redundantAnimatedChargeStrip: "hidden",
}));
