import fs from "node:fs";

const files = {
  client: "supabase/functions/_shared/passStudio.ts",
  wallet: "supabase/functions/_shared/passStudioWallet.ts",
  endpoint: "supabase/functions/account-privacy/index.ts",
  page: "src/pages/account/AccountPass.tsx",
  migration: "supabase/migrations/20260823165500_pass_studio_wallet_provider.sql",
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
assert(source.client.includes('sendEmail: false'), "app issuance should not force provider email delivery");
assert(source.wallet.includes('provider: "pass_studio"'), "provider mapping must be persisted server-side");
assert(source.page.includes('supabase.functions.invoke("account-privacy"'), "Chargeurs+ page must call the authenticated account endpoint");
assert(source.page.includes('action: "wallet_pass"'), "Chargeurs+ page must request the wallet_pass action");
assert(source.page.includes("Ajouter à Apple / Google Wallet"), "Wallet CTA missing");
assert(!source.page.includes("PASS_STUDIO_API_KEY"), "frontend must not know the provider API key");
assert(source.migration.includes("provider_add_to_wallet_url"), "provider wallet URL persistence missing");

console.log("[wallet-pass-studio] contract gate PASS");
