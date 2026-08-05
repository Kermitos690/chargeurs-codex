# DTA21269 staging rental test

Preconditions: DTA21269 online, slots reconciled, attendant at cabinet,
Stripe Test only, paired kiosk token and manual reconciliation plan.

1. Issue one QR for one rental session and scan it from a phone.
2. Complete only a Stripe Test payment.
3. Confirm one signed webhook and replay it to verify idempotence.
4. Do not release hardware before the separate explicit checkpoint.
5. Record public rental code, Checkout id, PaymentIntent id, webhook id and
   correlation ids with all secrets redacted.

No DTA21269 Stripe Test release is recorded by this document yet.
