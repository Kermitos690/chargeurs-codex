import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const safeFramePath = path.join(root, 'src/pages/kiosk-p0-safe-frame-1280.css');
const runtimePath = path.join(root, 'src/pages/KioskPremiumGateV3.tsx');

const css = fs.readFileSync(safeFramePath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const failures = [];

const requiredCssMarkers = [
  '@media (width: 1280px) and (height: 720px)',
  '--p0-safe-stage-w: 1024px',
  '--p0-safe-stage-h: 540px',
  'html.kiosk-v3[data-kiosk-scene="selection"] .kiosk-idle-stage',
  'height: 154px !important',
  'html.kiosk-v3[data-kiosk-scene="pricing"] .kiosk-pricing-stage',
  'grid-template-rows: 44px minmax(0, 1fr) 62px !important',
  'html.kiosk-v3[data-kiosk-scene="payment-choice"] .kiosk-payment-rail-stage',
  'height: 166px !important',
  'html.kiosk-v3[data-kiosk-scene="payment"] .kiosk-qr-stage',
  'width: 268px !important',
  'html.kiosk-v3[data-kiosk-scene="release"] .kiosk-release-stage',
  'html.kiosk-v3[data-kiosk-scene="support"] .kiosk-release-stage',
  'html.kiosk-v3[data-kiosk-scene="success"] .kiosk-ready-stage',
  'max-height: 390px !important',
  'html.kiosk-v3 .ck2-connected-grid',
  'html.kiosk-v3 .ck2-member-grid',
  'white-space: normal !important',
];

for (const marker of requiredCssMarkers) {
  if (!css.includes(marker)) failures.push(`missing safe-frame marker: ${marker}`);
}

const importMarker = 'import "./kiosk-p0-safe-frame-1280.css";';
if (!runtime.includes(importMarker)) failures.push(`missing runtime import: ${importMarker}`);

const safeIndex = runtime.indexOf(importMarker);
const supportIndex = runtime.indexOf('import "./kiosk-p0-support-safe.css";');
const adsIndex = runtime.indexOf('import "@/components/kiosk/kiosk-advertising-p0-safe.css";');
const geometryIndex = runtime.indexOf('import "./kiosk-1280-geometry-contract.css";');

if (safeIndex < 0 || supportIndex < 0 || safeIndex < supportIndex) {
  failures.push('safe frame must load after support safety CSS');
}
if (safeIndex < 0 || adsIndex < 0 || safeIndex < adsIndex) {
  failures.push('safe frame must load after advertising safety CSS');
}
if (safeIndex < 0 || geometryIndex < 0 || safeIndex < geometryIndex) {
  failures.push('safe frame must load after base geometry CSS');
}

// Presentation-only guard: inspect effective CSS, not explanatory comments.
const forbiddenTokens = [
  'stripe',
  'paymentintent',
  'chargenow',
  'ejectafterpayment',
  'supabase',
  'fetch(',
  'localstorage',
  'sessionstorage',
];
const executableCss = css.replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
for (const token of forbiddenTokens) {
  if (executableCss.includes(token)) failures.push(`business/runtime token forbidden in safe-frame CSS: ${token}`);
}

if (failures.length) {
  console.error('[kiosk-safe-frame] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[kiosk-safe-frame] PASS');
console.log(JSON.stringify({
  canvas: '1280x720',
  safeStage: '1024x540',
  selectionCardHeight: 154,
  paymentChoiceCardHeight: 166,
  qrSize: 268,
  releasePanelMaxHeight: 390,
  importedLast: true,
  presentationOnly: true,
}));
