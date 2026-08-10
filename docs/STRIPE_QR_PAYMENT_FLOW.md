# Stripe QR payment flow

The DTA kiosk is a QR display only. It never renders Stripe Elements, a card
form, Apple Pay, Google Pay, TWINT or NFC payment UI.

```text
Kiosk confirmation
  -> create-rental-session (kiosk token + idempotency key)
  -> create-stripe-checkout (same paired kiosk)
  -> hosted Stripe Checkout URL
  -> QR shown only on the kiosk
  -> customer phone opens hosted Checkout
  -> signed Stripe webhook
  -> server orchestrates ChargeNow release
```

`create-stripe-checkout` intentionally does not set `payment_method_types`.
Stripe Checkout therefore applies the payment methods enabled in the Stripe
Dashboard and eligible for the test account, CHF, country and customer device.
This is not a promise that a method will be displayed.

The QR is bound to one `rental_sessions` row, uses a Stripe idempotency key and
has a 30-minute expiry. An existing unexpired Checkout URL is reused for the
same rental. A retry after a Checkout failure reuses the same rental session;
it does not create a second rental intent.
