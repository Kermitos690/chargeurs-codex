import fs from "node:fs";

const files = {
  client: "supabase/functions/_shared/passStudio.ts",
  endpoint: "supabase/functions/customer-wallet-pass/index.ts",
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
assert(source.client.includes("/issue"), "issue endpoint contract missing");
assert(source.client.includes('"/instances/fields"'), "single-holder update contract missing");
assert(source.endpoint.includes('db.auth.getUser(token)'), "customer endpoint must authenticate the Supabase user");
assert(source.endpoint.includes('ACTIVE_MEMBERSHIP_REQUIRED'), "wallet issuance must require an active membership");
assert(source.endpoint.includes('sendEmail: false') || source.client.includes('sendEmail: false'), "app issuance should not force provider email delivery");
assert(source.endpoint.includes('provider: "pass_studio"'), "provider mapping must be persisted server-side");
assert(source.page.includes('supabase.functions.invoke("customer-wallet-pass"'), "Chargeurs+ page must call the authenticated wallet endpoint");
assert(source.page.includes("Ajouter à Apple / Google Wallet"), "Wallet CTA missing");
assert(!source.page.includes("PASS_STUDIO_API_KEY"), "frontend must not know the provider API key");
assert(source.migration.includes("provider_add_to_wallet_url"), "provider wallet URL persistence missing");

console.log("[wallet-pass-studio] contract gate PASS");
