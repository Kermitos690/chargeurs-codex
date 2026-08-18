# DTA21269 — qualification hardware read-only preflight — 2026-08-18

## Purpose

Prepare the supplier single-slot qualification without bypassing the active hardware quarantine and without sending payment, rental or ejection commands.

## Verified database evidence

- station: `DTA21269`
- environment: `staging`
- `is_pilot = true`
- `online = true`
- operational status: `maintenance`
- qualification mode: `read_only`
- physical inventory: 4/4 slots identified as occupied with battery IDs
- active kiosk device: present, APK `1.0.29-operator-recovery-staging`
- active hardware qualification runs: `0`
- quarantine remains active: `SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED`
- quarantine source rental: `11ea4c09-6356-4d5a-b4f9-d25d3dcdf171`

## New preflight function

`dta-pilot-preflight` is read-only and admin/JWT protected. It reads station, quarantine, slot inventory, active kiosk device, active qualification runs and environment guard booleans. It explicitly reports:

- `performedProviderMutation: false`
- `performedHardwareAction: false`
- `performedPaymentAction: false`
- `readyForExplicitOperatorQualification`
- `blockers[]`

It cannot change station mode, clear quarantine, create a provider order, call `ejectByRent`, start a Stripe payment or change inventory.

## Release rule

Do **not** clear the quarantine directly in SQL. Do **not** call the existing `start_freepay` action until:

1. read-only preflight has no blockers;
2. the station remains staging/pilot and ChargeNow is in test mode;
3. there is no active qualification run;
4. all four slot identities are stable;
5. an operator explicitly approves one controlled qualification cycle;
6. physical evidence is collected for exactly one requested slot and exactly one released battery;
7. return/reconciliation completes before any additional cycle.

Until those conditions are met, DTA21269 remains protected and DTA21277 remains the UX validation station.
