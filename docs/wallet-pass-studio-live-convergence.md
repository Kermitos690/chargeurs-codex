# Chargeurs+ Wallet — live Pass Studio convergence

Canonical tracking: #287. Agent 2 implementation: #297. Agent 8 physical acceptance: #298.

## Status verified on 2026-08-23

The live Supabase backend is ahead of `main` source control and already proves the provider path works:

- `account-privacy` is ACTIVE with JWT verification and accepts `action=wallet_pass`;
- the Pass Studio API credential is consumed server-side only;
- one Chargeurs+ membership is active;
- one `customer_wallet_passes` row is mapped to provider `pass_studio` with `provider_status=issued`;
- provider pass / instance / holder mappings are present;
- a provider-hosted Add-to-Wallet URL is present in the private database row;
- the pass has been issued and subsequently synchronized;
- Wallet sync outbox rows have reached `delivered`;
- provider failures are audited without exposing credentials.

Do not copy holder-specific Add-to-Wallet URLs into Git, logs, screenshots, issues or chat.

## Architecture

Pass Studio is a presentation/distribution provider. Chargeurs.ch remains authoritative for membership status, member pricing, daily cap, ChargePoints, validity and rental state.

The browser never receives `PASS_STUDIO_API_KEY`. `/compte/pass` calls the authenticated `account-privacy` Edge Function. The Edge Function resolves the configured Chargeurs+ Pass Studio template, filters holder fields against provider-declared editable fields, issues/deduplicates the holder and returns only the hosted Add-to-Wallet URL required for the immediate user action.

Existing pass synchronization is asynchronous where possible: the account endpoint enqueues a Wallet sync event, and the Wallet dispatcher re-reads current Chargeurs presentation state before pushing an update. Pass Studio failures therefore remain outside Stripe, rental, ejection, return, kiosk hardware and Advertising paths.

## Server configuration

Required secret:

- `PASS_STUDIO_API_KEY` — Supabase server secret only.

Recommended explicit configuration:

- `PASS_STUDIO_PASS_ID` — final Chargeurs+ template identifier;
- optional `PASS_STUDIO_PASS_NAME` — defaults to `Chargeurs+`.

The current provider client retains the verified template fallback for compatibility with the already-running deployment. Before changing that fallback, first confirm `PASS_STUDIO_PASS_ID` exists in the target Supabase environment; never trade a working live path for an unverified configuration cleanup.

## Dynamic field contract

Only provider fields reported as editable and not template-owned may be changed. Supported Chargeurs semantics include:

- ChargePoints balance;
- membership name / tier;
- member rate;
- daily cap;
- membership status;
- renewal credit;
- next renewal or membership end;
- offer details / conditions;
- validity / expiry.

No pricing constant is owned by the frontend.

## Current-main frontend contract

`/compte/pass` must:

1. show Add-to-Wallet only for an active/trialing Chargeurs+ membership;
2. call `account-privacy` with `{ action: "wallet_pass", walletAction: "issue" }` for add/open;
3. accept only HTTPS Pass Studio Add-to-Wallet URLs before navigation;
4. expose synchronization for an already issued pass through `walletAction:"sync"`;
5. never cache the provider delivery URL in local/session storage;
6. never show success if the Edge Function/provider request fails.

## Release gate

The clean replacement PR may merge only after:

`SOURCE_CONVERGED + BUILD_PASS + LIVE_BACKEND_MATCH + IDEMPOTENCY_PASS + PHYSICAL_WALLET_PASS`

Database/provider evidence proves server issuance and sync, but it does **not** prove the physical Apple Wallet / Google Wallet UI. Agent 8 must validate the exact candidate SHA on a physical phone before final release acceptance.

## Superseded work

PR #286 is closed and must not be revived wholesale. It diverged from current main and accumulated unrelated work. This convergence lane selectively ports only the Wallet behavior that matches the verified live deployment.