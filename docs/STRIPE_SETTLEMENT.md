# Stripe Test settlement

Stripe payment credentials are always collected on the customer phone, never by the DTA kiosk.

## Guarantee modes

The payment portal makes the guarantee mechanics explicit before Stripe Checkout is created.

### Card rails (`card_hold`)

- Stripe Checkout uses `card` rails, which can include eligible card wallets such as Apple Pay / Google Pay depending on Stripe/device eligibility.
- the 30 CHF guarantee uses `capture_method = manual`;
- `setup_future_usage = off_session` requests secure reuse of the payment method for contractually due supplemental/non-return amounts where Stripe and applicable authentication permit it;
- the rental can proceed once the server receives the verified authorized/capturable PaymentIntent state;
- after a confirmed physical return, the server captures only the final rental amount and releases the unused authorization.

### TWINT (`twint_prepaid`)

- the 30 CHF guarantee is debited at the start;
- after a confirmed return, the final rental amount is calculated from the frozen pricing snapshot;
- the unused balance is refunded through Stripe.

The customer-facing copy must never describe TWINT as a bank authorization or promise that an authorization will be invisible in the customer's banking interface.

## Completion invariant

A Stripe success page alone is never rental completion. The canonical completion path is:

```text
verified guarantee/payment
-> physically confirmed battery release
-> active rental
-> physically confirmed return
-> server pricing
-> Stripe capture/refund/supplement
-> settlement_status = settled
-> completed
-> final kiosk + phone receipt
```

Only persisted provider-confirmed amounts can be displayed as captured, refunded, released or final.
