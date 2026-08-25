import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cssPath = path.join(root, 'src/pages/kiosk-1280-geometry-contract.css');
const transactionPath = path.join(root, 'src/pages/kiosk-p0-transaction-readability.css');
const supportCssPath = path.join(root, 'src/pages/kiosk-p0-support-safe.css');
const adsPath = path.join(root, 'src/components/kiosk/kiosk-advertising-p0-safe.css');
const runtimePath = path.join(root, 'src/pages/KioskPremiumGateV3.tsx');
const paymentStatePath = path.join(root, 'src/lib/kioskPaymentState.ts');
const adsSyncPath = path.join(root, 'src/components/kiosk/KioskAdvertisingSynchronizedLayer.tsx');
const adsPartnerBridgePath = path.join(root, 'src/components/kiosk/KioskAdvertisingPartnerBridge.tsx');
const adsPartnerCssPath = path.join(root, 'src/components/kiosk/kiosk-advertising-partner-panel.css');
const adsPortraitRuntimePath = path.join(root, 'src/components/kiosk/KioskAdvertisingPortraitFocus.tsx');
const adsPortraitCssPath = path.join(root, 'src/components/kiosk/kiosk-advertising-portrait-focus.css');
const css = fs.readFileSync(cssPath, 'utf8');
const transactionCss = fs.readFileSync(transactionPath, 'utf8');
const supportCss = fs.readFileSync(supportCssPath, 'utf8');
const adsCss = fs.readFileSync(adsPath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const paymentState = fs.readFileSync(paymentStatePath, 'utf8');
const adsSync = fs.readFileSync(adsSyncPath, 'utf8');
const adsPartnerBridge = fs.readFileSync(adsPartnerBridgePath, 'utf8');
const adsPartnerCss = fs.readFileSync(adsPartnerCssPath, 'utf8');
const adsPortraitRuntime = fs.readFileSync(adsPortraitRuntimePath, 'utf8');
const adsPortraitCss = fs.readFileSync(adsPortraitCssPath, 'utf8');

function pxVar(name) {
  const match = css.match(new RegExp(`${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`));
  if (!match) throw new Error(`[kiosk-geometry] missing ${name}`);
  return Number(match[1]);
}

const canvasH = pxVar('--p0-canvas-h');
const footerH = pxVar('--p0-footer-h');
const padTop = pxVar('--p0-root-pad-top');
const padBottom = pxVar('--p0-root-pad-bottom');
const headerH = pxVar('--p0-header-h');
const headerGap = pxVar('--p0-header-gap');
const pricingH = pxVar('--p0-pricing-h');
const selectionH = pxVar('--p0-selection-h');

const productH = canvasH - footerH;
const mainH = productH - padTop - padBottom - headerH - headerGap;
const sparePricing = mainH - pricingH;
const spareSelection = mainH - selectionH;

const failures = [];
if (canvasH !== 720) failures.push(`canvas must stay 720px, got ${canvasH}`);
if (footerH <= 0 || footerH >= canvasH) failures.push(`invalid footer height ${footerH}`);
if (productH !== 638) failures.push(`product budget must be 638px, got ${productH}`);
if (mainH < 545) failures.push(`main workspace too small: ${mainH}px`);
if (pricingH > mainH) failures.push(`pricing scene ${pricingH}px exceeds main ${mainH}px`);
if (selectionH > mainH) failures.push(`selection scene ${selectionH}px exceeds main ${mainH}px`);
if (sparePricing < 36) failures.push(`pricing safety margin too small: ${sparePricing}px`);
if (spareSelection < 36) failures.push(`selection safety margin too small: ${spareSelection}px`);

const requiredContracts = [
  'grid-template-rows: var(--p0-header-h) minmax(0, 1fr)',
  'place-items: center',
  'box-sizing: border-box',
  'height: var(--p0-pricing-h)',
  'height: min(var(--p0-selection-h), 100%)',
  '[data-kiosk-scene="starting"]',
];
for (const marker of requiredContracts) {
  if (!css.includes(marker)) failures.push(`missing geometry contract marker: ${marker}`);
}

const requiredTransactionMarkers = [
  '.kiosk-pricing-card p.text-xl',
  'visibility: visible !important',
  '.kiosk-pricing-card p.mt-7',
  'grid-template-columns: repeat(3,minmax(0,1fr))',
  '.kiosk-qr-stage .kiosk-payment-mark',
  '.kiosk-slot-grid > .kiosk-slot-card:nth-child(2)',
  '[data-kiosk-scene="starting"]',
  '@keyframes p0StartingPulse',
];
for (const marker of requiredTransactionMarkers) {
  if (!transactionCss.includes(marker)) failures.push(`missing transaction readability marker: ${marker}`);
}

const requiredAdsMarkers = [
  'bottom: var(--p0-footer-h, 82px) !important',
  'html.kiosk-v3:not([data-kiosk-scene="home"]) .kiosk-ad-split',
  '.ck2-reference-home-main',
  '--p0-ads-rail-width',
  'z-index: 210 !important',
];
for (const marker of requiredAdsMarkers) {
  if (!adsCss.includes(marker)) failures.push(`missing advertising safety marker: ${marker}`);
}

const runtimeMarkers = [
  'import "./kiosk-p0-transaction-readability.css";',
  'import "./kiosk-1280-geometry-contract.css";',
  'import "@/components/kiosk/kiosk-advertising-p0-safe.css";',
  'import "./kiosk-p0-support-safe.css";',
  'KioskAdvertisingSynchronizedLayer',
  '<KioskAdvertisingSynchronizedLayer />',
  'scene = "starting"',
  'scene = protectedSupport ? "support" : "release"',
  'card.dataset.supportSecureLabel',
  'p0-deterministic-transaction-v2-ads-restored-2026-1280x720',
];
for (const marker of runtimeMarkers) {
  if (!runtime.includes(marker)) failures.push(`missing runtime marker: ${marker}`);
}
const readabilityIndex = runtime.indexOf('import "./kiosk-p0-transaction-readability.css";');
const geometryIndex = runtime.indexOf('import "./kiosk-1280-geometry-contract.css";');
const adsIndex = runtime.indexOf('import "@/components/kiosk/kiosk-advertising-p0-safe.css";');
const supportIndex = runtime.indexOf('import "./kiosk-p0-support-safe.css";');
if (readabilityIndex >= 0 && geometryIndex >= 0 && readabilityIndex > geometryIndex) {
  failures.push('geometry contract must remain after transaction readability');
}
if (geometryIndex >= 0 && adsIndex >= 0 && adsIndex < geometryIndex) {
  failures.push('advertising safety contract must load after base geometry');
}
if (adsIndex >= 0 && supportIndex >= 0 && supportIndex < adsIndex) {
  failures.push('support safety contract must load after advertising safety');
}

const supportPaymentMarkers = [
  'HARDWARE_EJECTION_DISABLED: { phase: "waitpay"',
  'BATTERY_ID_MISSING: { phase: "waitpay"',
  'BATTERY_CORRELATION_REQUIRED: { phase: "waitpay"',
  'chargenow_failed: { phase: "waitpay"',
  'eject_failed: { phase: "waitpay"',
  'needs_support: { phase: "waitpay"',
  'manual_review: { phase: "waitpay"',
];
for (const marker of supportPaymentMarkers) {
  if (!paymentState.includes(marker)) failures.push(`support state left protected polling runtime: ${marker}`);
}

const supportCssMarkers = [
  'html.kiosk-v3[data-kiosk-scene="support"] .kiosk-release-stage',
  '.kiosk-release-stage > :first-child',
  'content: attr(data-support-secure-label)',
  '.kiosk-ad-split,',
  '.kiosk-ad-screensaver',
  'display: none !important',
];
for (const marker of supportCssMarkers) {
  if (!supportCss.includes(marker)) failures.push(`missing protected support presentation marker: ${marker}`);
}

const partnerRuntimeMarkers = [
  'import { KioskAdvertisingPartnerBridge } from "./KioskAdvertisingPartnerBridge";',
  '<KioskAdvertisingLayer authoritativeClockOffsetMs={authoritativeClockOffsetMs} />',
  '<KioskAdvertisingPartnerBridge />',
];
for (const marker of partnerRuntimeMarkers) {
  if (!adsSync.includes(marker)) failures.push(`missing partner Ads runtime marker: ${marker}`);
}

const portraitRuntimeMarkers = [
  'import { KioskAdvertisingPortraitFocus } from "./KioskAdvertisingPortraitFocus";',
  '<KioskAdvertisingPortraitFocus />',
];
for (const marker of portraitRuntimeMarkers) {
  if (!adsSync.includes(marker)) failures.push(`missing portrait Ads runtime marker: ${marker}`);
}

const partnerBoundaryMarkers = [
  'class AdvertisingPartnerBoundary',
  'static getDerivedStateFromError',
  '<AdvertisingPartnerBoundary>',
  '<KioskAdvertisingPartnerBridgeRuntime />',
  'dataset.hasPartnerQr',
  'Chargeurs partner QR bridge disabled after async Ads error',
];
for (const marker of partnerBoundaryMarkers) {
  if (!adsPartnerBridge.includes(marker)) failures.push(`missing partner Ads isolation marker: ${marker}`);
}

const partnerCssMarkers = [
  '.kiosk-ad-split[data-has-partner-qr="true"] > .kiosk-ad-qr',
  '.kiosk-ad-screensaver[data-has-partner-qr="true"] > .kiosk-ad-qr',
  'display: none !important',
  '.kiosk-ad-partner-panel--split',
  '.kiosk-ad-partner-panel--screensaver',
];
for (const marker of partnerCssMarkers) {
  if (!adsPartnerCss.includes(marker)) failures.push(`missing partner Ads presentation marker: ${marker}`);
}

const portraitCssMarkers = [
  '.kiosk-ad-split .kiosk-ad-media',
  'object-fit: cover !important',
  'object-position: var(--kiosk-ad-focus-x, 50%) var(--kiosk-ad-focus-y, 45%) !important',
  '.kiosk-ad-split .kiosk-ad-media-backdrop',
  'display: none !important',
  '.kiosk-ad-split[data-has-partner-qr="true"] .kiosk-ad-media',
  'height: calc(100% - 158px) !important',
  'height: calc(100% - 142px) !important',
  'bottom: auto !important',
];
for (const marker of portraitCssMarkers) {
  if (!adsPortraitCss.includes(marker)) failures.push(`missing portrait Ads presentation marker: ${marker}`);
}

const portraitIsolationMarkers = [
  'const SAMPLE_SIZE = 56',
  'const FALLBACK_FOCUS = { x: 50, y: 45 }',
  'querySelectorAll<HTMLImageElement>(".kiosk-ad-split img.kiosk-ad-media")',
  'Never let smart cropping affect the Advertising runtime or kiosk shell',
  'return null;',
];
for (const marker of portraitIsolationMarkers) {
  if (!adsPortraitRuntime.includes(marker)) failures.push(`missing portrait Ads isolation marker: ${marker}`);
}

if (runtime.includes('KioskAdvertisingPartnerBridge')) {
  failures.push('partner QR bridge must never mount in the global kiosk runtime');
}
if (runtime.includes('KioskAdvertisingPortraitFocus')) {
  failures.push('portrait focus must never mount in the global kiosk runtime');
}

if (failures.length) {
  console.error('[kiosk-geometry] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[kiosk-geometry] PASS');
console.log(JSON.stringify({
  canvasH, footerH, productH, mainH, pricingH, sparePricing, selectionH, spareSelection,
  transactionReadability: true, physicalTopology: '1|3/2|4', startingScene: true,
  advertisingRuntime: true, advertisingFooterSafe: true, advertisingTransactionIsolated: true,
  partnerQrIsolated: true, partnerQrSingleOwner: true,
  portraitAdsFullBleed: true, portraitAdsFocalCrop: true, portraitAdsExplicitHeight: true,
  protectedSupportPolling: true, supportRestartSuppressed: true,
}));
