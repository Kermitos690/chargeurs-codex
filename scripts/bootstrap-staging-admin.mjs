import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
};

const supabaseUrl = required("SUPABASE_URL");
const serviceRole = required("SUPABASE_SERVICE_ROLE_KEY");
const email = required("STAGING_ADMIN_EMAIL").toLowerCase();
const publicAdminUrl = required("PUBLIC_ADMIN_URL");

if (!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(supabaseUrl)) {
  throw new Error("STAGING_SUPABASE_URL_INVALID");
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  throw new Error("STAGING_ADMIN_EMAIL_INVALID");
}
if (publicAdminUrl !== "https://chargeurs-ch-staging.vercel.app/admin") {
  throw new Error("PUBLIC_ADMIN_URL_INVALID");
}

const client = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let user = null;
for (let page = 1; page <= 10 && !user; page += 1) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw new Error("AUTH_USER_LIST_FAILED");
  user = data.users.find((candidate) => candidate.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 100) break;
}

let invited = false;
if (!user) {
  const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${publicAdminUrl}/reset-password`,
    data: { chargeurs_staging_owner: true },
  });
  if (error || !data.user) throw new Error("ADMIN_INVITATION_FAILED");
  user = data.user;
  invited = true;
}

const { data: organization, error: organizationError } = await client
  .from("organizations")
  .select("id,slug,legal_name")
  .eq("slug", "chargeurs-ch")
  .single();
if (organizationError || !organization) throw new Error("OWNER_ORGANIZATION_MISSING");

const { error: roleError } = await client.from("user_roles").upsert(
  { user_id: user.id, role: "super_admin" },
  { onConflict: "user_id,role", ignoreDuplicates: true },
);
if (roleError) throw new Error("ADMIN_ROLE_ASSIGNMENT_FAILED");

const { error: membershipError } = await client.from("organization_memberships").upsert(
  { organization_id: organization.id, user_id: user.id, role: "super_admin" },
  { onConflict: "organization_id,user_id,role", ignoreDuplicates: true },
);
if (membershipError) throw new Error("ADMIN_MEMBERSHIP_ASSIGNMENT_FAILED");

await client.from("audit_logs").insert({
  actor: user.id,
  action: invited ? "staging.owner.invited" : "staging.owner.reconciled",
  target: organization.id,
  data: { organization_slug: organization.slug, role: "super_admin" },
});

console.log(JSON.stringify({
  ok: true,
  email,
  invited,
  role: "super_admin",
  organization: organization.legal_name,
  login: publicAdminUrl,
}));
