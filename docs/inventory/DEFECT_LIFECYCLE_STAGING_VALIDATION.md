# AGENT 7 — Quarantine / Defect Lifecycle — Staging Validation

## Environment

- Supabase project: `chargeurs-ch-staging`
- Project ref: `xqepbqnaenoeyfjkjnzl`
- Branch: `agent/inventory/defect-lifecycle`
- Production: **not touched**

## Safety principle

`QUARANTINED` is not equivalent to `DEFECTIVE`.

The Inventory defect layer keeps three concepts separate:

1. runtime quarantine evidence;
2. suspected defect case;
3. confirmed diagnosis / repair / RMA history.

Runtime data is allowed to open a `suspected` case only when the source reason itself explicitly reports a suspected battery fault. It never auto-confirms category, severity, diagnosis, repairability or RMA state.

## Applied migration

- `inventory_defect_quarantine_lifecycle`

Created:

- `inventory_quarantine_cases`;
- `inventory_defect_cases`;
- `inventory_defect_events`;
- `inventory_repair_actions`;
- `inventory_reconcile_runtime_quarantines()`.

## Real staging result

Runtime reconciliation returned:

- active runtime quarantines observed: **2**;
- suspected defect cases observed: **1**;
- confirmed defects created: **0**.

### Quarantine cases

1. `PB-F0F0004F21`
   - source reason: `provider_order_create_2009_repeated`;
   - state: `active` quarantine;
   - provenance: `OBSERVED`;
   - **no defect case created**, because a provider/order anomaly is not proof of battery hardware failure.

2. `PB-FECA02C714`
   - source reason: `suspected_battery_fault_charge_drop`;
   - state: `active` quarantine;
   - provenance: `OBSERVED`.

### Suspected defect

Exactly one defect case exists for `PB-FECA02C714`:

- diagnostic status: `suspected`;
- category: `unknown`;
- severity: `unknown`;
- verification state: `observed`;
- source reason retained verbatim: `suspected_battery_fault_charge_drop`.

No case has been automatically promoted to `diagnosed`, `repaired`, `irreparable` or `supplier_rma`.

## Idempotence test

`supabase/tests/inventory-defect-lifecycle.sql` was executed on staging and passed.

Reconciliation was executed repeatedly and the test confirms:

- still exactly **2** active runtime quarantine cases;
- still exactly **1** runtime defect case;
- still exactly **1** observation event for the suspected fault;
- no duplicate cases/events were created.

## Security / performance proof

Direct privilege check for `inventory_reconcile_runtime_quarantines()`:

- `anon`: **cannot execute**;
- `authenticated`: **cannot execute**;
- `service_role`: **can execute**.

All five foreign-key relationships in the new quarantine/defect/repair tables have covering indexes.

Supabase security advisor therefore reports only the intentional `rls_enabled_no_policy` INFO state for the new Inventory tables; the Agent 7 reconciliation function is not exposed as an anonymous/authenticated `SECURITY DEFINER` RPC.

## Runtime isolation

No runtime quarantine flag or battery record is modified by Agent 7.

The reconciliation direction is one-way:

`runtime battery evidence → Inventory quarantine/defect history`

Never:

`Inventory case → runtime hardware mutation`.

## Next operational requirement

`PB-FECA02C714` now needs a real diagnostic procedure before its case can move beyond `suspected`. The current evidence does not support a defect category or severity yet.

`PB-F0F0004F21` should remain quarantine-only unless further diagnostics demonstrate an actual battery defect.
