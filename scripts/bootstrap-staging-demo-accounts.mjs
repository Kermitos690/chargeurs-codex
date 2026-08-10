import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
};

const supabaseUrl = required("SUPABASE_URL");
const serviceRole = required("SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const fail = (label, error) => {
  if (error) throw new Error(`${label}: ${error.message ?? String(error)}`);
};

async function findUser(email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    fail("LIST_USERS", error);
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 100) break;
  }
  return null;
}

async function ensureUser({ email, role, organizationId, displayName }) {
  let user = await findUser(email);
  let created = false;

  if (!user) {
    const result = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { staging_demo: true, role, display_name: displayName },
    });
    fail(`CREATE_USER_${role}`, result.error);
    user = result.data.user;
    created = true;
  }

  const { error: profileError } = await db.from("profiles").upsert({
    id: user.id,
    email,
    display_name: displayName,
    locale: "fr",
    preferred_language: "fr",
    marketing_consent: false,
  }, { onConflict: "id" });
  fail(`PROFILE_${role}`, profileError);

  const { error: roleError } = await db.from("user_roles").upsert(
    { user_id: user.id, role },
    { onConflict: "user_id,role" },
  );
  fail(`ROLE_${role}`, roleError);

  if (organizationId) {
    const { error: membershipError } = await db.from("organization_memberships").upsert(
      { organization_id: organizationId, user_id: user.id, role },
      { onConflict: "organization_id,user_id,role" },
    );
    fail(`MEMBERSHIP_${role}`, membershipError);
  }

  return { email, role, userId: user.id, created };
}

const owner = await findUser("teba.gaetan@gmail.com");
if (!owner) throw new Error("OWNER_NOT_FOUND");

const { data: ownerOrganization, error: ownerOrganizationError } = await db
  .from("organizations")
  .select("id,slug")
  .eq("slug", "chargeurs-ch")
  .single();
fail("OWNER_ORGANIZATION", ownerOrganizationError);

let { data: partnerOrganization, error: partnerOrganizationError } = await db
  .from("organizations")
  .select("id,slug,legal_name")
  .eq("slug", "demo-partner-epalinges")
  .maybeSingle();
fail("FIND_PARTNER_ORGANIZATION", partnerOrganizationError);

if (!partnerOrganization) {
  const result = await db.from("organizations").insert({
    slug: "demo-partner-epalinges",
    legal_name: "Partenaire demo Epalinges",
    kind: "partner",
    status: "active",
    metadata: { staging_demo: true, purpose: "role-account-review" },
  }).select("id,slug,legal_name").single();
  fail("CREATE_PARTNER_ORGANIZATION", result.error);
  partnerOrganization = result.data;
}

let { data: partner, error: partnerError } = await db
  .from("partners")
  .select("id")
  .eq("organization_id", partnerOrganization.id)
  .maybeSingle();
fail("FIND_PARTNER", partnerError);

if (!partner) {
  const result = await db.from("partners").insert({
    legal_name: "Partenaire demo Epalinges",
    trade_name: "Demo Partner Epalinges",
    partner_type: "establishment",
    address: "Rte de Berne 222",
    city: "Epalinges",
    country: "CH",
    email: "teba.gaetan+partner-owner@gmail.com",
    manager_name: "Compte de demonstration",
    commission_rate: 10,
    billing_method: "transfer",
    status: "active",
    notes: "Donnee de demonstration staging uniquement.",
    organization_id: partnerOrganization.id,
  }).select("id").single();
  fail("CREATE_PARTNER", result.error);
  partner = result.data;
}

let { data: shop, error: shopError } = await db
  .from("shops")
  .select("id")
  .eq("partner_id", partner.id)
  .eq("name", "Demo Partner Epalinges")
  .maybeSingle();
fail("FIND_SHOP", shopError);

if (!shop) {
  const result = await db.from("shops").insert({
    name: "Demo Partner Epalinges",
    address: "Rte de Berne 222",
    city: "Epalinges",
    contact_name: "Compte de demonstration",
    contact_email: "teba.gaetan+partner-owner@gmail.com",
    active: true,
    partner_id: partner.id,
  }).select("id").single();
  fail("CREATE_SHOP", result.error);
  shop = result.data;
}

const { error: stationError } = await db.from("stations").upsert({
  station_id: "DEMO-PARTNER-001",
  cabinet_id: null,
  name: "Borne de demonstration partenaire",
  location_name: "Demo Partner Epalinges",
  status: "unknown",
  online: false,
  rentable_count: 0,
  returnable_count: 0,
  total_count: 0,
  currency: "CHF",
  price_per_period: 1.5,
  organization_id: partnerOrganization.id,
  partner_id: partner.id,
  environment: "staging",
  is_pilot: false,
  kiosk_url: "https://chargeurs-ch-staging.vercel.app/kiosk/DEMO-PARTNER-001",
}, { onConflict: "station_id" });
fail("CREATE_DEMO_STATION", stationError);

const accounts = [];
for (const [email, role, organizationId, displayName] of [
  ["teba.gaetan+operations@gmail.com", "operations_admin", ownerOrganization.id, "Staging operations"],
  ["teba.gaetan+finance@gmail.com", "finance_admin", null, "Staging finance"],
  ["teba.gaetan+support@gmail.com", "support_agent", null, "Staging support"],
  ["teba.gaetan+maintenance@gmail.com", "maintenance_technician", null, "Staging maintenance"],
  ["teba.gaetan+partner-owner@gmail.com", "partner_owner", partnerOrganization.id, "Partenaire demo proprietaire"],
  ["teba.gaetan+partner-staff@gmail.com", "partner_staff", partnerOrganization.id, "Partenaire demo equipe"],
  ["teba.gaetan+customer@gmail.com", "customer", null, "Client demo"],
]) {
  accounts.push(await ensureUser({ email, role, organizationId, displayName }));
}

console.log(JSON.stringify({
  ok: true,
  note: "STAGING_ONLY_NO_PASSWORDS",
  partnerOrganization,
  partner: { id: partner.id, shopId: shop.id },
  demoStation: "DEMO-PARTNER-001",
  accounts,
}, null, 2));
