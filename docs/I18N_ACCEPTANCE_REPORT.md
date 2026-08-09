# Kiosk i18n acceptance report

The kiosk has FR, EN and DE dictionaries. `Kiosk.tsx` consumes `t()` instead
of a French `STATE_MSG` map for rental, QR, status and error paths.

Automated local checks confirm every `kiosk.*` key exists in FR, EN and DE,
that EN and DE translate visible payment text, and that legacy French literals
in the principal kiosk flow are rejected.

Persistence uses `chargeurs.kiosk.language`. The selected language is submitted
when creating a rental and used by hosted Checkout for the supported Stripe
`locale`. WebView and email delivery validation remain pending deployment.
