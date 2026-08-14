# Ownership Matrix

One capability has one primary owner. Contributors may read or assist through a
handoff, but cannot take ownership by adjacency or file touch.

| Domain | Primary owner | Allowed contributors | Reviewer / validator | Release gate | Handoff to |
| --- | --- | --- | --- | --- | --- |
| Governance, WIP and collision control | A0 | A1, A8 | A0 | A0 | relevant owner |
| Product architecture and cross-domain contracts | A1 | A0, A2, A4, A7, A8 | A1 | A8 if release-affecting | domain owner |
| Pricing, Checkout, PaymentIntent and settlement contracts | A2 | A3, A8 | A2 + A1 for Protected Core | A8 | A4 for projections |
| Rental lifecycle and hardware-command intent | A2 after A3 RCA handoff | A3, A7, A8 | A2 + A1 | A8 | A4 for presentation |
| Root-cause analysis and minimal safety correction | A3 | relevant domain owner | A3 | A8 when shipped | actual domain owner |
| Kiosk presentation, navigation and user-facing state | A4 | A5, A6, A2/A3 as truth providers | A4 | A8 physical matrix | A8 |
| Advertising campaigns, playlist, media and playback | A5 | A4, A8 | A5 | A8 when deployed | A4 |
| 3D/motion primitives and safe degradation | A6 | A4, A8 | A4 for kiosk semantics; A6 for primitive quality | A8 if release-relevant | A4 |
| Inventory, supplier evidence and serialized asset truth | A7 | A2, A3, A8 | A7 | A8 for field readiness | A9 for capacity |
| Integration, release identity, rollback and physical QA | A8 | every domain owner supplies evidence | A8 | A8 | A0 / human release decision |
| Growth, venues, events and partnerships | A9 | A7, A1/A2, A8 | A9 + required truth owner | A8 for readiness | human business decision |

## Safety boundaries

- Kiosk displays prices but does not own or calculate charge truth.
- Advertising may read an explicit kiosk surface contract but may not affect a
  rental transaction. `AD_FAILURE = NO_AD`, never rental failure.
- Inventory may observe physical events but cannot rewrite rental state or issue
  hardware commands.
- Growth may not promise capacity, release readiness, price, terms, refunds or
  a feature without the relevant source of truth and human business approval.
- A release owner validates evidence; only a human authorizes production when a
  business or external-risk decision is involved.
