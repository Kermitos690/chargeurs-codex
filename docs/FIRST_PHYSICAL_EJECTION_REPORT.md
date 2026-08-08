# First physical ejection report

Status: **executed once in Stripe Test staging; financial settlement remains pending.**

## Controlled test evidence

- Human checkpoint received: `AUTORISER ÉJECTION TEST DTA21269 SLOT 4`.
- Station: `DTA21269`.
- Slot: `4`.
- Rental session: `a7b316dd-0bdd-4ad1-aede-e99a3b9918fb`.
- Stripe mode: **Test only**.
- Physical result: the attendant confirmed that the battery was released.
- Supplier response limitation: it confirmed the command without an exploitable
  battery identifier; the first physical release was therefore reconciled only
  after an attendant confirmed battery `F0F000503E`.
- Return result: the attendant subsequently confirmed that this battery was
  returned to slot 4. The rental and inventory are recorded as
  `return_detected` / `returned_human_confirmed`.

## What this does and does not prove

The test proves one controlled physical release and one physically confirmed
return. It does **not** prove an automatic ChargeNow return callback, automatic
battery identity reporting, or a completed final Stripe Test settlement. Those
steps remain explicit gates and must not be inferred from the physical result.

## Safety rules retained

Every future physical release still requires its own explicit human checkpoint:

```text
AUTORISER ÉJECTION TEST DTA21269 SLOT X
```

It is limited to staging, one paid Test rental, one identified slot and one
short-lived server-side permit. No automatic retry follows a timeout.
