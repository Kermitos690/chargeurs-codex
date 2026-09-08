# WisePad 3 Stripe Terminal TEST backend — rollback

Scope: PR #168 / #169 / #171 convergence. STAGING TEST only.

## Principle
Rollback is fail-safe and evidence-preserving. Do not drop rental/payment evidence merely to restore QR-only operation.

## Immediate operational rollback
1. Disable every Terminal station binding first:

```sql
update public.stripe_terminal_station_bindings
set enabled = false, updated_at = now()
where enabled = true;
```

2. Stop serving/deploying `stripe-terminal-backend` from the staging release manifest.
3. Keep the existing `create-stripe-checkout` function available. QR Checkout remains the canonical fallback rail.
4. Do not alter pricing, ejection, BATTERY_IN, return or settlement state as part of Terminal rollback.

## QR rail-guard trigger rollback
The trigger is defense-in-depth only after this PR because `create-stripe-checkout` now claims the QR rail before any Stripe Checkout create/retrieve side effect.

If the trigger itself causes a staging regression, remove only the trigger/function:

```sql
begin;

drop trigger if exists rental_sessions_guard_qr_checkout_payment_rail
  on public.rental_sessions;

drop function if exists public.guard_qr_checkout_payment_rail();

commit;
```

This does not delete rentals, Checkout sessions, rail claims, Terminal attempts or Stripe IDs.

## Full Terminal DB rollback
Only use this before any accepted integrated TEST release, after Terminal bindings are disabled and after confirming no active/reconciliation-required Terminal attempt exists.

```sql
select rental_session_id, rail, claim_state
from public.rental_payment_rail_claims
where rail = 'stripe_terminal'
  and claim_state <> 'released';

select rental_session_id, stripe_payment_intent_id, status, reconciliation_required
from public.stripe_terminal_payment_attempts
where reconciliation_required = true
   or status not in ('canceled','failed','timed_out');
```

If either query returns rows, STOP: reconcile/cancel safely first. Do not delete the claim to force QR.

After both return zero rows, code may be reverted to the pre-#168 release. The Terminal tables should normally be retained as audit evidence. Destructive table drops are deliberately not part of normal rollback.

## Claim recovery rule
A Terminal claim may return to `NONE` only when:
- no Stripe PaymentIntent side effect occurred; or
- Stripe itself confirms the PaymentIntent is `canceled`/terminally failed and local reconciliation is not marked uncertain.

`reconciliation_required` is fail-closed. Never manually rewrite it to `released` to make QR available.

## Verification after rollback
- Terminal binding(s): disabled.
- `stripe-terminal-backend`: absent from active staging manifest or unreachable by the kiosk build.
- QR Checkout TEST: creation/reuse still succeeds.
- no new Terminal PaymentIntent is created.
- no pricing values changed.
- no ejection command sent by rollback.
- no return/settlement record rewritten.
