# ChargeNow callback fix

## Root cause

Historical provider callbacks arrived with `amp;token` rather than `token`:

```text
...?rental=<id>&amp;token=<scoped-hmac>
```

The callback verifier only read `token`, producing `401 INVALID_CALLBACK_AUTH`.
This can leave a paid rental waiting for provider confirmation.

## Corrected contract

New callback URLs carry one canonical query parameter only:

```text
.../chargenow-rent-callback?token=<rental-scoped-hmac>
```

The callback first resolves the rental using the provider trade number, then
checks the token scoped to that rental. Legacy `amp;token` is accepted only as
the same scoped HMAC, never as a global secret. Missing, forged and wrong-rental
tokens are rejected.

## Evidence

`deno test --allow-env supabase/functions/tests/chargenow_callback_auth.test.ts`
passed locally: canonical generation, historical compatibility, missing token,
forged token, query ordering and legacy header tests.

## Required staging proof

Deploy the matching function only after migration alignment, create one
controlled Test order, then preserve the callback request fingerprint, callback
event row, rental id, trade number, slot and battery correlation. This document
does not claim that a real callback has yet succeeded after this change.
