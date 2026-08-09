# Stripe Test settlement

Stripe Checkout remains hosted and QR initiated. The kiosk never collects card
or wallet credentials. Checkout and Stripe webhook processing are separate from
hardware delivery.

The 30 CHF amount must be described according to the actual payment method:
some methods support authorization/capture differently while others can only be
debited and later partially refunded. Do not call it a preauthorization until a
method-specific Test proof exists.

Target completion is: confirmed return -> server pricing snapshot calculation ->
one settlement strategy execution -> persisted PaymentIntent/refund result ->
customer receipt. A Stripe success page alone is not completion.

Current status: Checkout and a Stripe Test payment have been observed in prior
pilot work. Return-driven settlement/refund remains NOT PROVEN and blocks RC1.
