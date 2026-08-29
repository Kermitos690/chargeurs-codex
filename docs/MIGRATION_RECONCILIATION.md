# Chargeurs.ch — Migration Reconciliation

Status date: **2026-08-29**
Project audited read-only: `xqepbqnaenoeyfjkjnzl` (`chargeurs-ch-staging`)

> **DO NOT RUN `SUPABASE DB PUSH` UNTIL MIGRATION RECONCILIATION IS COMPLETE.**

This document records counts and a future reconciliation method. It does not
change a ledger row, migration file, schema object or database record.

## Baseline counts

| Measure | Count |
|---|---:|
| SQL migration files in `main` | 151 |
| Unique Git migration versions | 149 |
| Staging migration-ledger entries | 257 |
| Unique Git versions absent from the staging ledger | 35 |
| Staging ledger versions absent from `main` | 143 |

The counts describe version identifiers only. They do not prove that every
Git-only migration effect is absent from the schema: some staging hotfixes may
have implemented an equivalent effect under a different ledger version.
Conversely, a matching name or similar SQL fragment is not proof of semantic
equivalence.

## Duplicated Git timestamps

The following version prefixes each identify more than one file in Git:

- `20260810194000`
- `20260818193000`

These must be mapped to their exact filenames, checksums and runtime effects.
They must not be casually renamed or rewritten against staging. Any resolution
must preserve an immutable mapping from the historical identifiers to the final
canonical history.

## Known late staging history

The staging ledger includes, among other entries:

- `20260827022446_member_pricing_v3_final`
- `20260827042221_chargeurs_pass_launch_offer`
- `20260827070406_revoke_internal_trigger_rpc_execute_20260827`
- `20260827071013_enforce_kiosk_beta_station_scope_20260827`
- `20260827074915_point_dta21269_kiosk_to_cloudflare_staging_20260827`
- `20260827123937_align_dta21269_kiosk_to_vercel_staging`

The last two entries demonstrate a historical Cloudflare switch followed by an
explicit return to Vercel. Deleting the first entry would destroy history; it
must be represented as superseded, not erased.

Pricing V3/prepaid objects are present in staging while the repository and
ledger do not provide a single reconciled application narrative. Production
and blind staging pushes therefore remain `NO-GO`.

## Historical reconciliation documents

`docs/STAGING_MIGRATION_RECONCILIATION.md` and
`docs/SUPABASE_MIGRATION_RECONCILIATION.md` contain valuable earlier audit and
recovery evidence, but their dates, branch scope and counts predate this
baseline. They are `HISTORICAL` inputs, not the current count authority. Their
individual mappings must be imported into the future three-way register rather
than discarded.

## Risks of a blind push

A blind push can:

- reject the plan because versions conflict;
- attempt to apply an effect already present under another version;
- overwrite or invalidate a staging-only hotfix;
- apply repository-only business behavior unintentionally;
- leave Git, schema and ledger even further apart;
- make a later clean-room reconstruction impossible to explain.

## Future reconciliation procedure

The following procedure is descriptive and is not executed in this phase.

1. **Freeze evidence** — export read-only ledger metadata, schema definitions,
   grants, policies, functions, triggers, extensions and relevant checksums.
2. **Build a three-way register** — map each Git version to ledger entry and
   observed schema effect: exact match, equivalent effect, Git-only,
   runtime-only, data-only marker or unknown.
3. **Recover staging-only source** — recover the exact SQL where available.
   Where exact SQL cannot be recovered, record the schema definition and the
   evidence limitation; do not invent historical SQL.
4. **Resolve duplicated prefixes** — determine historical order and effect,
   then design a forward-only canonical representation. Do not rewrite applied
   staging history.
5. **Separate business changes** — exclude new pricing, payment, hardware or
   authorization behavior from the ledger-reconciliation PR.
6. **Reconstruct in isolation** — replay the candidate canonical history on a
   disposable database created for verification.
7. **Compare semantics** — compare tables, columns, constraints, indexes,
   triggers, RPC definitions, RLS, grants, extensions and critical seed/state
   expectations with staging.
8. **Review a dry plan** — produce a human-reviewed dry-run plan targeted only
   at staging. Any destructive or business-changing statement blocks the plan.
9. **Approve a rollback/restore point** — prove backup and restoration before
   any staging ledger or schema write.
10. **Apply only through a dedicated approved change** — execution requires a
    later PR and explicit authorization; this documentation is not approval.
11. **Re-audit** — require a zero-unexplained-drift ledger/schema report after
    the approved reconciliation.

## Completion criteria

`ONE_CANONICAL_MIGRATION_HISTORY` is achieved only when:

- every one of the 257 staging ledger versions is mapped;
- every canonical Git migration has one unambiguous version and checksum;
- duplicated timestamp handling is documented and forward-safe;
- a clean database can reproduce the intended schema;
- staging comparison has no unexplained schema or privilege drift;
- no business behavior was silently introduced during reconciliation.

Current status: **NOT ACHIEVED / NO-GO FOR DB PUSH**.
