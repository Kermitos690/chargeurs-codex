/**
 * P0 recovery quarantine.
 *
 * The global offers launcher used to mount before the canonical kiosk surface
 * had finished booting, then disappear after DOM detection. On the physical
 * WebView this produced a visible extra CTA / close-overlay generation during
 * cold start. Offers are nonessential to rental safety, so the launcher is
 * intentionally disabled until the single-owner runtime passes physical QA.
 */
export function KioskOffersLauncher() {
  return null;
}
