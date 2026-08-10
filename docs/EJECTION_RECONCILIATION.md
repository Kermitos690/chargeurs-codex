# Ejection reconciliation

Before a provider mutation, persist one `hardware_commands` intent with a
unique rental/command key. A timeout yields `UNKNOWN_PROVIDER_RESULT`; it never
causes an automatic second ejection.

`reconcile_ejection` must combine provider order status, authenticated callback,
cabinet/slot transition, battery presence and cabinet events into one of:

- `CONFIRMED_EJECTED`
- `CONFIRMED_NOT_EJECTED`
- `AMBIGUOUS`

Only a human-authorised test may call the provider. A physical observation must
be correlated with station, slot, battery, command and rental before it is
marked PHYSICALLY_VERIFIED.

The existing safety permit remains required. This RC work does not globally
remove it and does not issue any hardware command.
