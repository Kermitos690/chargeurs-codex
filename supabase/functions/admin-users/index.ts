// admin-users — ADMIN ONLY gateway to list back-office users and manage their
// roles. Every mutation is server-side, role-gated (super admin) and audited.
// Roles live in the separate user_roles table (never on profiles) to prevent
// privilege escalation. A safety guard prevents removing the last admin.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireSuperAdmin, auditLog } from "../_shared/db.ts";

const ASSIGNABLE = [
  "super_admin", "admin", "platform_admin", "operations_admin", "finance_admin",
  "support_manager", "support_agent", "maintenance_manager", "maintenance_technician",
  "powerbank_manager", "mifi_manager", "advertising_manager", "reports_analyst",
  "franchise_owner", "franchise_admin", "franchise_staff",
  "agency_owner", "agency_admin", "agency_staff",
  "partner_owner", "partner_staff", "venue_manager", "venue_staff",
  "vip_customer", "customer",
  "staff", "operator", "viewer",
] as const;
type Assignable = (typeof ASSIGNABLE)[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeResetOrigin(req: Request): string {
  const configured = (Deno.env.get("APP_URL") ?? Deno.env.get("PUBLIC_APP_URL") ?? "").trim();
  if (configured) {
    try { return new URL(configured).origin; } catch { /* use request origin below */ }
  }
  const origin = req.headers.get("origin") ?? "";
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "https:" || parsed.hostname === "localhost") return parsed.origin;
  } catch { /* ignored */ }
  return "https://chargeurs.ch";
}

function isExistingUserError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string; status?: number } | null;
  const code = String(candidate?.code ?? "").toLowerCase();
  const message = String(candidate?.message ?? "").toLowerCase();
  return code === "email_exists" || candidate?.status === 422 || message.includes("already") || message.includes("exists") || message.includes("registered");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  const adminId = await requireSuperAdmin(req, db);
  if (!adminId) return json({ ok: false, error: "FORBIDDEN" }, 403);

  let payload: { action?: string; userId?: string; role?: string; email?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "INVALID_BODY" }, 400);
  }
  const { action, userId, role, email } = payload;

  try {
    if (action === "list") {
      const { data: list, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (error) return json({ ok: false, error: "USER_LIST_FAILED" }, 500);

      const ids = list.users.map((u) => u.id);
      const { data: roleRows } = ids.length
        ? await db.from("user_roles").select("user_id, role").in("user_id", ids)
        : { data: [] as Array<{ user_id: string; role: string }> };
      const { data: profiles } = ids.length
        ? await db.from("profiles").select("id, display_name, phone").in("id", ids)
        : { data: [] as Array<{ id: string; display_name: string | null; phone: string | null }> };

      const rolesByUser = new Map<string, string[]>();
      for (const r of roleRows ?? []) {
        const arr = rolesByUser.get(r.user_id) ?? [];
        arr.push(r.role);
        rolesByUser.set(r.user_id, arr);
      }
      const profById = new Map((profiles ?? []).map((p) => [p.id, p]));

      const users = list.users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        email_confirmed_at: u.email_confirmed_at ?? null,
        display_name: profById.get(u.id)?.display_name ?? null,
        phone: profById.get(u.id)?.phone ?? null,
        roles: rolesByUser.get(u.id) ?? [],
      }));
      return json({ ok: true, users });
    }

    if (action === "set_role") {
      if (!userId || !role || !ASSIGNABLE.includes(role as Assignable)) {
        return json({ ok: false, error: "INVALID_ROLE" }, 400);
      }
      const { error } = await db.from("user_roles").insert({ user_id: userId, role });
      if (error && error.code !== "23505" && !String(error.message).toLowerCase().includes("duplicate")) {
        return json({ ok: false, error: "ROLE_GRANT_FAILED" }, 500);
      }
      await auditLog(db, { actor: adminId, action: "users.role.grant", target: userId, data: { role } });
      return json({ ok: true });
    }

    if (action === "remove_role") {
      if (!userId || !role) return json({ ok: false, error: "INVALID_ROLE" }, 400);
      if (role === "admin" || role === "super_admin") {
        const { count } = await db.from("user_roles")
          .select("id", { count: "exact", head: true }).eq("role", role);
        if ((count ?? 0) <= 1) return json({ ok: false, error: "LAST_ADMIN_PROTECTED" }, 409);
      }
      const { error } = await db.from("user_roles").delete().eq("user_id", userId).eq("role", role);
      if (error) return json({ ok: false, error: "ROLE_REVOKE_FAILED" }, 500);
      await auditLog(db, { actor: adminId, action: "users.role.revoke", target: userId, data: { role } });
      return json({ ok: true });
    }

    if (action === "invite") {
      const normalizedEmail = String(email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
        return json({ ok: false, error: "INVALID_EMAIL" }, 400);
      }
      const redirectTo = `${safeResetOrigin(req)}/admin/reset-password`;
      const { data, error } = await db.auth.admin.inviteUserByEmail(normalizedEmail, { redirectTo });
      if (error) {
        if (isExistingUserError(error)) {
          return json({
            ok: false,
            error: "USER_ALREADY_EXISTS",
            recoveryAvailable: true,
            message: "Ce compte existe déjà. Utilisez la récupération de mot de passe si nécessaire.",
          }, 409);
        }
        return json({ ok: false, error: "INVITE_FAILED" }, 500);
      }
      await auditLog(db, { actor: adminId, action: "users.invite", target: data.user?.id ?? null, data: { email: normalizedEmail } });
      return json({ ok: true, userId: data.user?.id ?? null });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (e) {
    console.error("admin-users", e instanceof Error ? e.name : "UNKNOWN_ERROR");
    return json({ ok: false, error: "ADMIN_USERS_INTERNAL_ERROR" }, 500);
  }
});
