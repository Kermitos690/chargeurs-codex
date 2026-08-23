# DTA21269 WisePad detection grace — 2026-08-23

Physical regression observed on DTA21269: WisePad connected, but kiosk skipped Terminal + QR and went directly to QR.

Root cause: installed native shell `1.0.35-terminal-v300-readiness-staging` can briefly project `ABSENT` before USB reader re-probe completes, while the web fallback treated that first snapshot as definitive.

Fix merged in PR #293: one non-financial `refreshPaymentReader()` probe per rental session and a bounded detection grace before automatic QR fallback. READY still yields Terminal + QR. Persistent ABSENT/ERROR after the grace window still falls back to QR. No payment, supplier release or battery ejection is triggered by this change.
