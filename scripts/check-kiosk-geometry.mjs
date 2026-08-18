import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cssPath = path.join(root, 'src/pages/kiosk-1280-geometry-contract.css');
const transactionPath = path.join(root, 'src/pages/kiosk-p0-transaction-readability.css');
const runtimePath = path.join(root, 'src/pages/KioskPremiumGateV3.tsx');
const css = fs.readFileSync(cssPath, 'utf8');
const transactionCss = fs.readFileSync(transactionPath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');

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
if (productH !== 658) failures.push(`product budget must be 658px, got ${productH}`);
if (mainH < 560) failures.push(`main workspace too small: ${mainH}px`);
if (pricingH > mainH) failures.push(`pricing scene ${pricingH}px exceeds main ${mainH}px`);
if (selectionH > mainH) failures.push(`selection scene ${selectionH}px exceeds main ${mainH}px`);
if (sparePricing < 24) failures.push(`pricing safety margin too small: ${sparePricing}px`);
if (spareSelection < 24) failures.push(`selection safety margin too small: ${spareSelection}px`);

const requiredContracts = [
  'grid-template-rows: var(--p0-header-h) minmax(0, 1fr)',
  'place-items: center',
  'box-sizing: border-box',
  'height: var(--p0-pricing-h)',
  'height: min(var(--p0-selection-h), 100%)',
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
];
for (const marker of requiredTransactionMarkers) {
  if (!transactionCss.includes(marker)) failures.push(`missing transaction readability marker: ${marker}`);
}

const readabilityImport = 'import "./kiosk-p0-transaction-readability.css";';
const geometryImport = 'import "./kiosk-1280-geometry-contract.css";';
const readabilityIndex = runtime.indexOf(readabilityImport);
const geometryIndex = runtime.indexOf(geometryImport);
if (readabilityIndex < 0) failures.push('transaction readability stylesheet is not imported');
if (geometryIndex < 0) failures.push('geometry contract stylesheet is not imported');
if (readabilityIndex >= 0 && geometryIndex >= 0 && readabilityIndex > geometryIndex) {
  failures.push('geometry contract must remain the final framing authority');
}

if (failures.length) {
  console.error('[kiosk-geometry] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[kiosk-geometry] PASS');
console.log(JSON.stringify({ canvasH, footerH, productH, mainH, pricingH, sparePricing, selectionH, spareSelection, transactionReadability: true }));
