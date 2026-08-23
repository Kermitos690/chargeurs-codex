# Chargeurs+ — Pass Studio setup contract

Pass Studio is only the Wallet presentation/distribution provider. Chargeurs.ch remains canonical for membership status, pricing and ChargePoints.

## Confirmed provider template

Physical/mobile studio evidence on 2026-08-23 confirms the real template exists:

- studio name: `Chargeurs+`
- studio number: `#1001`
- Pass Studio pass ID: `kBQ15unyR1QPeUhcRWID`
- current studio state at capture time: `Brouillon`
- credits visible at capture time: `50`
- current holders: `0`

Prefer binding production with server-side `PASS_STUDIO_PASS_ID=kBQ15unyR1QPeUhcRWID` once the card is activated. The identifier is not a secret; the API key remains secret.

The public Pass Studio REST API lists, issues and updates passes; creation/design is performed in the Pass Studio studio UI. There is no documented REST endpoint for creating the visual template itself.

## Current native membership fields

The studio membership template already exposes these user-facing fields:

- Nom du membre — filled from holder identity at issuance
- N° de membre — generated automatically by Pass Studio
- Solde de points — synchronized from Chargeurs ChargePoints when its API field key is editable
- Niveau — synchronized from the active Chargeurs+ membership plan when editable
- Détails de l'offre — synchronized from backend member pricing/cap when editable
- Conditions — synchronized with the active-membership condition when editable
- Expiration de l'offre — synchronized from the membership period end when editable

Do not overwrite the native holder name or generated member number. The backend reads `/passes` metadata and maps Chargeurs values only onto editable, non-template-owned field keys.

Backward-compatible custom keys are also supported when present: `membership_status`, `membership_name`, `member_rate`, `daily_cap`, `chargepoints`, `valid_until`.

## Important studio configuration before first live issue

1. Change `Carte : Brouillon` to the active/published state only after visual review.
2. Clear the global `Expiration de la carte` currently shown as `10 août 2027`. Chargeurs+ membership end dates vary by customer; the per-holder `Expiration de l'offre` must be driven by the Chargeurs backend instead.
3. Keep QR Code as the barcode type.
4. Keep `Utiliser le n° de membre comme code-barres` disabled so Pass Studio can mint the unique instance barcode used by the integration.
5. `Camera Scan` can remain disabled for the first Wallet test.
6. Keep `https://chargeurs.ch` as the website link.
7. Locations can remain empty for the first test; venue/station relevance can be introduced later without blocking issuance.

## Images still required in the studio

The current studio captures show all image slots empty. Add branded assets before activation:

- Icon — required, 87×87 px
- Logo — recommended, 480×150 px or larger
- Banner — recommended, 1125×432 px (minimum 750×288)
- Thumbnail — recommended, 270×270 px

Google Wallet will show a generic blue square until the logo/banner assets are configured.

## Required server secrets

- `PASS_STUDIO_API_KEY` — secret API key; server only
- `PASS_STUDIO_PASS_ID` — recommended: `kBQ15unyR1QPeUhcRWID`
- optional `PASS_STUDIO_PASS_NAME` — defaults to `Chargeurs+`

Never expose the API key through Vite variables, browser storage, HTML, logs or Git.

## Runtime flow

1. Authenticated customer opens `/compte/pass`.
2. The UI calls the already-deployed `account-privacy` Edge Function with `action: "wallet_pass"`.
3. Edge Function verifies the Supabase account and active Chargeurs+ membership.
4. Edge Function resolves the configured Pass Studio template and refuses a draft/non-active template with `PASS_STUDIO_PASS_NOT_ACTIVE`.
5. First issue uses `POST /passes/{passId}/issue` with `sendEmail:false`.
6. Dedupe is provider-side by customer email.
7. The instance is immediately synchronized with `PATCH /instances/fields` because Pass Studio documents that fields are not reapplied on a dedupe hit.
8. Chargeurs persists only provider IDs, barcode and the hosted `addToWalletUrl`; never the provider API key.
9. Browser receives only the safe hosted Add-to-Wallet URL and navigates to it.

`account-privacy` is intentionally reused because the current Supabase project has reached its Edge Function count limit. No function is deleted and no paid plan upgrade is required for this integration.

## Activation gate before production merge

- [x] provider columns exist in `customer_wallet_passes`
- [x] `account-privacy` supports the authenticated `wallet_pass` action
- [x] Chargeurs+ frontend preview builds successfully
- [x] real Pass Studio template `Chargeurs+` / `#1001` exists
- [x] real native membership field structure confirmed from studio screenshots
- [ ] global card expiry cleared
- [ ] icon/logo/banner assets configured
- [ ] template changed from Draft to active/published
- [ ] Pass Studio API key exists in the provider account
- [ ] `PASS_STUDIO_API_KEY` configured as a Supabase Edge Function secret
- [ ] `PASS_STUDIO_PASS_ID=kBQ15unyR1QPeUhcRWID` configured server-side
- [ ] one real authenticated Chargeurs+ account successfully receives `addToWalletUrl`
- [ ] resulting pass opens in Apple Wallet or Google Wallet on a physical phone

Until the unchecked provider items are complete, keep the frontend PR out of production. Provider failure must never mutate membership, pricing, rentals, payment, ejection or return state.

## Cost behavior

Pass Studio documents that each genuinely new issuance costs 1 credit, while an email dedupe hit is free. Single-holder field updates are free. With the 50 credits visible in the studio capture, avoid bulk distribution during testing; issue only the controlled test holder first.
