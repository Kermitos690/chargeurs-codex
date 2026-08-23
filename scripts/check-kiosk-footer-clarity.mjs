import fs from "node:fs";

const footerPath = "src/components/kiosk/KioskSystemFooter.tsx";
const cssPath = "src/pages/kiosk-footer-home-pricing.css";
const gatePath = "src/pages/KioskPremiumGateV3.tsx";
const footer = fs.readFileSync(footerPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const gate = fs.readFileSync(gatePath, "utf8");

function fail(message) {
  console.error(`[kiosk-footer-clarity] FAIL: ${message}`);
  process.exit(1);
}

const footerStart = footer.indexOf('<footer');
const footerEnd = footer.indexOf('</footer>');
if (footerStart < 0 || footerEnd <= footerStart) fail("cannot isolate system footer markup");
const footerMarkup = footer.slice(footerStart, footerEnd);

if (footerMarkup.includes("kiosk-system-footer__commercial")) fail("commercial pricing must not render inside system footer");
if (!footer.includes('className="kiosk-home-pricing-summary"')) fail("Home pricing summary is missing");
if (!footer.includes('daily: "Plafond 24 h"')) fail("French Home cap label is missing");
if (!footer.includes('deposit: "Caution"')) fail("French deposit label is missing");

if (!css.includes('grid-template-columns: minmax(0, 1fr) auto !important')) fail("system footer must use two-column layout");
if (!css.includes('html.kiosk-v3 .kiosk-system-footer__commercial')) fail("legacy commercial footer region must be explicitly suppressed");
if (!css.includes('display: none !important')) fail("Home pricing summary must default to hidden");
if (!css.includes('html.kiosk-v3[data-kiosk-scene="home"] .kiosk-home-pricing-summary')) fail("pricing summary must be Home-scoped");
if (!css.includes('top: 11px !important')) fail("Home pricing summary must stay in the topbar safe zone");

const globalImport = gate.indexOf('import "./kiosk-global-legibility.css";');
const footerImport = gate.indexOf('import "./kiosk-footer-home-pricing.css";');
if (footerImport < 0 || footerImport <= globalImport) fail("footer clarity authority must load after global legibility CSS");

console.log("[kiosk-footer-clarity] PASS");
console.log(JSON.stringify({
  footerColumns: 2,
  commercialPricingInFooter: false,
  homePricingSummary: true,
  homeOnly: true,
  importedLast: true,
}));
