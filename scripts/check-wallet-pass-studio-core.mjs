import fs from "node:fs";

const paths = {
  page: "src/pages/account/AccountPass.tsx",
  accountData: "src/pages/account/accountData.ts",
  endpoint: "supabase/functions/account-privacy/index.ts",
  client: "supabase/functions/_shared/passStudio.ts",
  wallet: "supabase/functions/_shared/passStudioWallet.ts",
  providerMigration: "supabase/migrations/20260823165500_pass_studio_wallet_provider.sql",
  realtimeMigration: "supabase/migrations/20260823201500_chargeurs_wallet_realtime_v1.sql",
  permissionsMigration: "supabase/migrations/20260823205000_wallet_realtime_internal_rpc_permissions.sql",
};

const source = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(path, "utf8")]),
);
const all = Object.values(source).join("\n");

function assert(condition, message) {
  if (!condition) throw new Error(`[wallet-pass-studio-core] ${message}`);
}

assert(!/ps_live_[A-Za-z0-9_-]+/.test(all), "live Pass Studio credentials must never be committed");
assert(source.client.includes('Deno.env.get("PASS_STUDIO_API_KEY")'), "Pass Studio key must come from server environment");
assert(source.client.includes("https://www.passstudio.online/api/v1"), "canonical provider API base URL missing");
assert(source.client.includes("/issue"), "provider issue contract missing");
assert(source.client.includes('"/instances/fields"'), "provider holder update contract missing");
assert(source.client.includes("sendEmail: false"), "application issuance must not force provider email delivery");
assert(source.client.includes("resendIfExists: false"), "repeat issue must use provider dedupe semantics");

assert(source.endpoint.includes('db.auth.getUser(token)'), "account Wallet route must authenticate the Supabase user");
assert(source.endpoint.includes('action === "wallet_pass"'), "account Wallet action missing");
assert(source.endpoint.includes('walletAction === "sync"'), "explicit Wallet sync path missing");
assert(source.endpoint.includes("enqueue_customer_wallet_sync_event"), "existing pass sync must enqueue asynchronous refresh");
assert(!source.endpoint.includes("PASS_STUDIO_API_KEY"), "endpoint must not inline the provider key");

assert(source.wallet.includes("ACTIVE_MEMBERSHIP_REQUIRED"), "Wallet issuance must require active membership");
assert(source.wallet.includes('.in("status", ["active", "trialing"])'), "membership eligibility contract drifted");
assert(source.wallet.includes("customer_wallet_presentation_state"), "Wallet update must use canonical presentation state");
assert(source.wallet.includes('provider: "pass_studio"'), "provider mapping must be persisted");
assert(source.wallet.includes("provider_add_to_wallet_url"), "provider delivery URL persistence missing");

assert(source.page.includes('supabase.functions.invoke("account-privacy"'), "account page must call authenticated account endpoint");
assert(source.page.includes('action: "wallet_pass"'), "account page Wallet action missing");
assert(source.page.includes("Ajouter à Apple / Google Wallet"), "Add-to-Wallet CTA missing");
assert(!source.page.includes("PASS_STUDIO_API_KEY"), "frontend must never know the provider key");

assert(source.accountData.includes("provider: string | null"), "private Wallet summary must expose provider identity only, not provider secrets");
assert(source.providerMigration.includes("provider_add_to_wallet_url"), "provider mapping schema missing");
assert(source.realtimeMigration.includes("customer_wallet_sync_outbox"), "Wallet sync outbox missing");
assert(source.realtimeMigration.includes("customer_wallet_presentation_state"), "canonical Wallet presentation RPC missing");
assert(source.permissionsMigration.includes("revoke all on function public.customer_wallet_presentation_state(uuid) from public, anon, authenticated"), "Wallet presentation RPC must stay backend-only");

console.log("[wallet-pass-studio-core] PASS");
