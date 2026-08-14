# Protected Core

Protected Core is the set of contracts where a local convenience, UI fallback,
or unverified provider response may cause incorrect payment, rental, hardware,
security, or settlement behavior.

## Protected registry

| Protected capability | Primary owner | Non-negotiable rule |
| --- | --- | --- |
| Server pricing resolution and immutable snapshot | A2 | frontend cannot calculate charge truth |
| Stripe Checkout, PaymentIntent, capture, refund and settlement | A2 | signed/server evidence controls money state |
| Rental lifecycle and transactional idempotency | A2 | state/version transitions are server-owned and idempotent |
| Hardware command intent and supplier eject mutation | A2 after A3 RCA | persist one authorized intent before one supplier mutation |
| Kiosk device authentication and credentials | A2 / native owner through A3 RCA | no credential leak or insecure fallback |
| Battery release evidence | A2 | provider acknowledgement is not physical release proof |
| Physical return correlation | A2 | exact contractual battery and accepted `BATTERY_IN` evidence precede settlement |
| Non-return handling | A2 | no timer or UI guess creates a charge decision |
| Privileged DB, RLS, migrations and secrets | A2 | no broad bypass for debugging; secrets never enter logs or UI |

## Change gates

Every change in this registry must include `PROTECTED_CORE_CHANGE` in its PR or
handoff and provide:

1. A3 RCA evidence when the work is incident-driven.
2. The A2 domain-owner implementation and targeted tests.
3. A1 review for cross-domain contract or invariant impact.
4. A8 integration evidence and, where relevant, exact physical validation.
5. Explicit human approval for business-policy or external-risk decisions.

The following are forbidden:

- client-side fallback that weakens a server fail-closed rule;
- timer-driven payment, ejection, return or settlement success;
- an automatic second ejection after ambiguous supplier result;
- settlement without accepted physical return evidence;
- a security/RLS bypass used as a production fix;
- reinterpreting animation, DOM state, a Git merge, or an HTTP 200 as physical
  proof.
