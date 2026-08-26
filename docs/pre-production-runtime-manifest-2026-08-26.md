# Chargeurs.ch runtime manifest — 2026-08-26

This manifest is intentionally conservative: the branch can prove what is
versioned, while authenticated staging exports record deployed code. Only the
two targeted hardening migrations were applied to staging; no Edge Function was
deployed, renamed or deleted.

| Critical path | Classification | Git evidence | Required next action |
| --- | --- | --- | --- |
| Public rental-session creation | VERSIONED_NOT_DEPLOYED | `create-rental-session` | Compare deployed digest before production. |
| Public Stripe Checkout | VERSIONED_NOT_DEPLOYED | `public-stripe-checkout`, `create-stripe-checkout` | Compare deployed digest. |
| Stripe webhook gateway / canonical webhook | VERSIONED_NOT_DEPLOYED | `stripe-webhook-gateway`, `stripe-webhook` | Compare deployed digest. |
| Stripe Terminal backend | VERSIONED_NOT_DEPLOYED | Staging export v14, verify_jwt=false, digest `edcd1d72024c60760a5ed0fdffca11d6f4ee72696cfa6c4d7765884d45fdca7e` | Source was recovered exactly, then this branch added a contract-acceptance guard; deploy only after legal review and staging validation. |
| Eject after payment | VERSIONED_NOT_DEPLOYED | `eject-after-payment` | Compare deployed digest. |
| ChargeNow callback/event gateway | VERSIONED_NOT_DEPLOYED | `chargenow-rent-callback`, `cabinet-event-push` | Compare deployed digest. |
| Rental settlement / return | VERSIONED_NOT_DEPLOYED | `settle-rental-payment`, `kiosk-return-summary`, `kiosk-cabinet-snapshot` | Compare deployed digest. |
| Kiosk enrollment/authentication | VERSIONED_NOT_DEPLOYED | `kiosk-enroll`, shared enrollment code | Compare deployed digest. |
| Advertising runtime | VERSIONED_NOT_DEPLOYED | `kiosk-ads-playlist`, `kiosk-ads-clock` | Compare deployed digest. |
| Notification dispatcher (`noop`) | DEPLOYED_AND_VERSIONED | Staging export v20, verify_jwt=false, digest `76977b4711e4a38cf94557a51f8ae289024632fd82a080b3dbdf79df7928dd76` | Source recovered exactly; keep both automatic paths disabled, then deploy a new canonical slug only after source review. |
| Transactional e-mail worker | VERSIONED_NOT_DEPLOYED | `process-rental-email-outbox` | Compare deployed digest. |
| Wallet / PassStudio path | VERSIONED_NOT_DEPLOYED | `account-privacy`, shared PassStudio code | Compare deployed digest; keep automatic pushes disabled. Custom Pass field labels are mapped to stable provider keys in source; manually set pass #1002 to `unique` distribution and verify its returned `fieldLabels` before enabling it. |

## One-shot / legacy surface

The versioned function tree contains no `ops-*-once` or `*-diagnostic-once`
Edge Function. Current `dta-pilot-*` functions remain safety/test procedures and
are not candidates for deletion. Remote function inventory remains mandatory
before deleting a deployed legacy slug.

## SECURITY DEFINER classification

| Function group | Classification | Action in this PR |
| --- | --- | --- |
| `kiosk_quote`, `kiosk_session_status`, `effective_price` | PUBLIC_INTENTIONAL | No ACL change; each is a capability/read path with explicit public grants. |
| Rental/payment/return claim, settlement and reservation helpers | SERVICE_ROLE_ONLY | No blanket change; their current Edge server callers require them. Remote ACL export remains required. |
| `reconcile_dta21269_pre_release_missing_authorization_projection` | LEGACY_REMOVE | Revoke `PUBLIC`, `anon`, `authenticated`; retain only `service_role` if the historical runtime still has it. |
| Trigger functions (price, wallet, quarantine, battery and incident projections) | TRIGGER_ONLY | No direct grant is introduced. |
| Pairing and wallet presentation helpers | AUTHENTICATED_REQUIRED / NEEDS_REVIEW | No safe global revoke without the deployed ACL export and current client call graph. |

The migration includes a database assertion: if any overload of the historical
reconciliation helper still grants `anon` execute after revocation, migration
application fails rather than leaving a silent P0 exposure.

## Required safe remote procedure

The staging exports for `stripe-terminal-backend` and `noop` were reviewed
and recovered here. Do not deploy, rename or delete either function until the
remaining production/source comparisons have been completed.
