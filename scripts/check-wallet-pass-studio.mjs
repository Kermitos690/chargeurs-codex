import fs from "node:fs";

const files = {
  client: "supabase/functions/_shared/passStudio.ts",
  wallet: "supabase/functions/_shared/passStudioWallet.ts",
  endpoint: "supabase/functions/account-privacy/index.ts",
  dispatcher: "supabase/functions/noop/index.ts",
  page: "src/pages/account/AccountPass.tsx",
  providerMigration: "supabase/migrations/20260823165500_pass_studio_wallet_provider.sql",
  realtimeMigration: "supabase/migrations/20260823201500_chargeurs_wallet_realtime_v1.sql",
  dispatchMigration: "supabase/migrations/20260823204500_wallet_dispatch_10s.sql",
  permissionsMigration: "supabase/migrations/20260823205000_wallet_realtime_internal_rpc_permissions.sql",
  nativeNotificationMigration: "supabase/migrations/20260823211000_wallet_native_notification_intents.sql",
};

const source = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, "utf8")]));
const all = Object.values(source).join("\n");

function assert(condition, message) {
  if (!condition) throw new Error(`[wallet-pass-studio] ${message}`);
}

assert(!/ps_live_[A-Za-z0-9_-]+/.test(all), "live Pass Studio API key must never be committed");
assert(source.client.includes('Deno.env.get("PASS_STUDIO_API_KEY")'), "provider key must come from server environment");
assert(source.client.includes("https://www.passstudio.online/api/v1"), "canonical Pass Studio API base URL missing");
assert(source.client.includes('DEFAULT_PASS_STUDIO_PASS_ID = "kBQ15unyR1QPeUhcRWID"'), "active Chargeurs+ Pass Studio template binding missing");
assert(source.client.includes("/issue"), "issue endpoint contract missing");
assert(source.client.includes('"/instances/fields"'), "single-holder update contract missing");
assert(source.endpoint.includes('db.auth.getUser(token)'), "account endpoint must authenticate the Supabase user");
assert(source.endpoint.includes('action === "wallet_pass"'), "wallet action must be hosted by account-privacy");
assert(source.wallet.includes('ACTIVE_MEMBERSHIP_REQUIRED'), "wallet issuance must require an active membership");
assert(source.wallet.includes('.in("status", ["active", "trialing"])'), "Wallet membership eligibility must mirror /compte/pass");
assert(source.wallet.includes('Tarif membre : ${values.memberRate}'), "Wallet must mirror canonical member rate label");
assert(source.wallet.includes('Plafond journalier : ${values.dailyCap}'), "Wallet must mirror canonical daily-cap label");
assert(source.wallet.includes('Statut adhésion : ${values.membershipStatus}'), "Wallet must mirror canonical membership status label");
assert(source.wallet.includes('Crédit adhésion / renouvellement'), "Wallet must support the canonical renewal credit field");
assert(source.wallet.includes('"Prochaine échéance" | "Fin de l’adhésion"'), "Wallet must mirror canonical membership date semantics");
assert(source.wallet.includes('customer_wallet_presentation_state'), "manual Wallet sync must consume canonical realtime presentation state");
assert(source.wallet.includes('applyRealtimePresentation'), "manual Wallet sync must overlay realtime fields before provider update");
assert(source.client.includes('sendEmail: false'), "app issuance should not force provider email delivery");
assert(source.wallet.includes('provider: "pass_studio"'), "provider mapping must be persisted server-side");
assert(source.page.includes('supabase.functions.invoke("account-privacy"'), "Chargeurs+ page must call the authenticated account endpoint");
assert(source.page.includes('action: "wallet_pass"'), "Chargeurs+ page must request the wallet_pass action");
assert(source.page.includes("Ajouter à Apple / Google Wallet"), "Wallet CTA missing");
assert(!source.page.includes("PASS_STUDIO_API_KEY"), "frontend must not know the provider API key");
assert(source.providerMigration.includes("provider_add_to_wallet_url"), "provider wallet URL persistence missing");

assert(source.realtimeMigration.includes("customer_wallet_sync_outbox"), "realtime Wallet outbox missing");
assert(source.realtimeMigration.includes("enqueue_customer_wallet_sync_event"), "realtime Wallet enqueue contract missing");
assert(source.realtimeMigration.includes("customer_wallet_presentation_state"), "canonical Wallet presentation RPC missing");
assert(source.realtimeMigration.includes("queue_due_customer_wallet_price_transitions"), "price-stage scanner missing");
assert(source.realtimeMigration.includes("'10 seconds'"), "price-stage scanner must run every 10 seconds");
assert(source.realtimeMigration.includes("price_stage_changed"), "price-stage event missing");
assert(source.realtimeMigration.includes("daily_cap_reached"), "daily-cap event missing");
assert(source.realtimeMigration.includes("rental_started"), "rental-start Wallet event missing");
assert(source.realtimeMigration.includes("return_detected"), "return-detected Wallet event missing");
assert(source.realtimeMigration.includes("rental_settled"), "settlement Wallet event missing");
assert(source.realtimeMigration.includes("chargepoints_changed"), "ChargePoints Wallet event missing");
assert(source.dispatcher.includes("processWalletOutbox"), "existing dispatcher must process Wallet outbox");
assert(source.dispatcher.includes('db.rpc("customer_wallet_presentation_state"'), "dispatcher must re-read current presentation before provider push");
assert(source.dispatcher.includes('status: "delivered"'), "dispatcher must persist delivered outbox state");
assert(source.dispatchMigration.includes("'10 seconds'"), "Wallet dispatcher cron must run every 10 seconds");
assert(source.permissionsMigration.includes("revoke all on function public.customer_wallet_presentation_state(uuid) from public, anon, authenticated"), "realtime presentation RPC must remain backend-only");

assert(source.nativeNotificationMigration.includes("customer_wallet_native_notifications"), "native Wallet notification intent table missing");
assert(source.nativeNotificationMigration.includes("customer_wallet_native_notification_mirror_trg"), "customer push -> native Wallet intent mirror missing");
assert(source.nativeNotificationMigration.includes("after insert on public.notifications"), "native intent mirror must follow canonical customer notification creation");
assert(source.nativeNotificationMigration.includes("provider_capability_blocked"), "unsupported native provider delivery must remain explicit/fail-safe");
assert(source.nativeNotificationMigration.includes("PASS_STUDIO_TRANSACTIONAL_NOTIFICATION_API_UNAVAILABLE"), "provider capability blocker must be machine-readable");
assert(!source.client.includes("/campaigns"), "do not invent an undocumented Pass Studio transactional campaign API endpoint");

console.log("[wallet-pass-studio] contract gate PASS");
