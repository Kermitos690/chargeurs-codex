# Legal and customer-contract pre-production review

Status: 2026-08-26. This is an engineering and disclosure review, not legal
advice or a declaration of Swiss-law compliance. Human Swiss consumer-law review
is required before commercial launch.

## Legal document map

| Document | Source | Public route | Version / updated | Linked from | Stale | Action |
| --- | --- | --- | --- | --- | --- | --- |
| Conditions générales de location | `src/pages/LegalPage.tsx` | `/legal/conditions` | `terms-2026-08-26-preproduction-v2` | Kiosk contract review, mobile payment view, legal page | No for technical flow; legal approval pending | Complete operator identity and legal review |
| Politique de confidentialité | `src/pages/LegalPage.tsx` | `/legal/confidentialite` | `privacy-2026-08-26-preproduction-v2` | Kiosk contract review, mobile payment view, legal page | No for processor/telemetry wording; retention policy pending | Confirm controller identity and formal retention schedule |
| Mentions légales | `src/pages/LegalPage.tsx` | `/legal/mentions-legales` | 2026-08-26 | Legal page | **Yes** | Add legal entity, postal address and any applicable IDE/TVA |
| Kiosk acceptance screen | `src/pages/Kiosk.tsx` | kiosk only | 2026-08-26 | Kiosk payment rail | No | Deploy only after review of the matching Edge functions |
| Mobile/web acceptance | `src/pages/PaymentChoice.tsx` | `/pay/:rentalSessionId/choose` | 2026-08-26 | QR payment route | No | Retain current explicit checkbox |

## Contract acceptance implementation

- The checkbox starts unchecked; it contains no marketing consent.
- The kiosk opens a modal without changing the selected rental session. It has a
  close action, summary, terms/privacy links and QR URL
  `https://chargeurs.ch/legal/conditions`.
- `record-rental-contract-acceptance` authenticates the station-bound kiosk,
  writes the terms/privacy versions and server timestamp to `rental_sessions`,
  and writes the surface and language to the audit log.
- `create-stripe-checkout` and `stripe-terminal-backend` reject payment creation
  unless those current versions and timestamp are present. The web Checkout
  endpoint records the same evidence before its Stripe call.
- Completed rentals retain `contract_terms_version`, `contract_privacy_version`
  and `contract_accepted_at`; the pricing snapshot and hash retain the price
  basis. The existing customer language plus the acceptance audit entry provide
  locale and surface evidence without duplicating personal data.

## Contract consistency against staging configuration

Read-only staging snapshot at review time contained two active non-default price
profiles. These values must **not** be promoted as approved public pricing until
the operator confirms which profile and station assignment is commercial.

| Term | CGV value before this review | Current staging runtime | Match | Source of truth |
| --- | --- | --- | --- | --- |
| Rental price / increment | Static public tiers in legal page | Active profiles include 40 centimes / 30 min and 790 centimes / 1,440 min | No | Per-rental `pricing_snapshot` |
| Daily cap | Static 18 CHF | Active profiles include 5.90 CHF and 0 CHF | No | Per-rental `pricing_snapshot` |
| Guarantee | CGV said none | Both active profiles: 30 CHF | No | Per-rental `pricing_snapshot` |
| Non-return | 99 CHF after 72 h | Both active profiles: 6.30 CHF after 4,320 min | No | Per-rental `pricing_snapshot` |
| Return obligation | Compatible station and verified physical correlation | Same | Yes | Rental state machine / physical event evidence |
| Wallet benefit | Not a monetary promise | Manual issue path only; automatic sync/push disabled | Yes | `app_settings` hardening policy |

Static monetary statements were removed from the public terms in favour of the
immutable price snapshot shown before acceptance. The unresolved commercial
choice of profile, guarantee and non-return rule is a **LEGAL/PRICING BLOCKER**.

## Privacy processing reconciliation

The privacy page now identifies the operational roles reflected in code:
Chargeurs.ch (controller, identity pending), Supabase (authentication/database/
server functions), Stripe (payment), ChargeNow (hardware supplier), Resend
(transactional email only when configured), PassStudio (explicit Wallet action
only), Vercel (web hosting), and advertising/kiosk/security telemetry. Raw
advertising impressions retain about 14 days before aggregation; no verified
retention schedule was found for financial, rental or contract evidence, so the
policy does not invent one.

## Human review required

1. Supply and approve the legal entity, postal address, contact channel and
   applicable registration details.
2. Approve the commercial pricing profile and verify every station assignment,
   guarantee, non-return deadline and amount against the published CGV.
3. Review proportionality, collection conditions and dispute process for
   non-return and saved-payment-method wording.
4. Approve the retention schedule for financial, contract, incident and support
   records; verify processor contracts and any international transfers.

Swiss official consumer guidance requires clear seller identity/contact details,
the technical steps to contract conclusion and prompt order confirmation; it
also warns that abusive CGV clauses causing a significant unjustified imbalance
are void. See the SECO sources cited in the pre-production report.
