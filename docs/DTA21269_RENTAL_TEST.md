# DTA21269 staging rental test

Preconditions: DTA21269 online, slots reconciled, attendant at cabinet,
Stripe Test only, paired kiosk token and manual reconciliation plan.

1. Issue one QR for one rental session and scan it from a phone.
2. Complete only a Stripe Test payment.
3. Confirm one signed webhook and replay it to verify idempotence.
4. Do not release hardware before the separate explicit checkpoint.
5. Record public rental code, Checkout id, PaymentIntent id, webhook id and
   correlation ids with all secrets redacted.

## Recorded pilot result

One controlled Stripe Test pilot release was completed for slot 4 after the
explicit human checkpoint. The released battery and its return were confirmed
by the attendant and reconciled as `F0F000503E` / slot 4. The supplier did not
return a usable battery identifier in the ejection response, so this is a
human-confirmed reconciliation rather than proof of automatic provider
correlation.

The return is recorded; final Stripe Test settlement is still pending and must
be performed through the audited settlement path, never by a client or kiosk.
