import fs from "node:fs";

const css = fs.readFileSync("src/pages/kiosk-global-legibility.css", "utf8");
const gate = fs.readFileSync("src/pages/KioskPremiumGateV3.tsx", "utf8");

function fail(message) {
  console.error(`[kiosk-global-legibility] FAIL: ${message}`);
  process.exit(1);
}
function pxVar(name) {
  const m = css.match(new RegExp(`${name}\\s*:\\s*(\\d+)px`));
  if (!m) fail(`missing ${name}`);
  return Number(m[1]);
}
function firstPx(selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m"));
  if (!block) fail(`missing block ${selector}`);
  const value = block[1].match(new RegExp(`${property}\\s*:\\s*(?:clamp\\()?\\s*(\\d+(?:\\.\\d+)?)px`));
  if (!value) fail(`missing ${property} in ${selector}`);
  return Number(value[1]);
}

const footer = pxVar("--p0-footer-h");
const header = pxVar("--p0-header-h");
if (footer < 80 || footer > 86) fail("system footer must have kiosk-scale visual presence");
if (header < 64 || header > 70) fail("header must have kiosk-scale visual presence");

const headerButton = firstPx("html.kiosk-v3 .kv3-product-layer > .kiosk-root > header > div > button", "font-size");
const footerSecure = firstPx("html.kiosk-v3 .kiosk-system-footer__secure", "font-size");
const footerStation = firstPx("html.kiosk-v3 .kiosk-system-footer__station", "font-size");
const footerRuntime = firstPx("html.kiosk-v3 .kiosk-system-footer__time,\nhtml.kiosk-v3 .kiosk-system-footer__network", "font-size");
const homeTitle = firstPx("html.kiosk-v3 .ck2-home .ck2-reference-heading h1,\nhtml.kiosk-v3 .ck2-home .ck2-home-title", "font-size");
const homeBody = firstPx("html.kiosk-v3 .ck2-home .ck2-reference-heading p", "font-size");
const pricingTitle = firstPx('html.kiosk-v3[data-kiosk-scene="pricing"] .kiosk-pricing-stage > h2', "font-size");
const paymentTitle = firstPx('html.kiosk-v3[data-kiosk-scene="payment-choice"] .kiosk-payment-rail-stage > h2', "font-size");
const paymentBody = firstPx('html.kiosk-v3[data-kiosk-scene="payment-choice"] .kiosk-payment-rail-stage > p', "font-size");
const qrTitle = firstPx('html.kiosk-v3[data-kiosk-scene="payment"] .kiosk-qr-stage h2', "font-size");

if (headerButton < 18) fail("header controls are too small");
if (footerSecure < 14) fail("secure-payment footer copy is too small");
if (footerStation < 16) fail("station identity in footer is too small");
if (footerRuntime < 14) fail("time/network footer copy is too small");
if (homeTitle < 50) fail("Home title is too small");
if (homeBody < 19) fail("Home supporting copy is too small");
if (pricingTitle < 44) fail("pricing title is too small");
if (paymentTitle < 44 || paymentBody < 19) fail("payment choice copy is too small");
if (qrTitle < 42) fail("QR payment title is too small");

const importSelection = gate.indexOf('import "./kiosk-p0-selection-fit.css";');
const importGlobal = gate.indexOf('import "./kiosk-global-legibility.css";');
if (importGlobal < 0 || importGlobal <= importSelection) fail("global legibility authority must load after selection fit");
if (/transform\s*:\s*scale\(/.test(css)) fail("global HMI scale must not use page-level zoom transforms");

console.log("[kiosk-global-legibility] PASS");
console.log(JSON.stringify({
  headerHeightPx: header,
  footerHeightPx: footer,
  headerButtonPx: headerButton,
  footerSecurePx: footerSecure,
  footerStationPx: footerStation,
  footerRuntimePx: footerRuntime,
  homeTitlePx: homeTitle,
  homeBodyPx: homeBody,
  pricingTitlePx: pricingTitle,
  paymentTitlePx: paymentTitle,
  paymentBodyPx: paymentBody,
  qrTitlePx: qrTitle,
  pageZoom: false,
  importedLast: true,
}));
