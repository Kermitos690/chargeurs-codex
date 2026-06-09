// admin-users — ADMIN ONLY gateway to list back-office users and manage their
// roles. Every mutation is server-side, role-gated (requireAdmin) and audited.
// Roles live in the separate user_roles table (never on profiles) to prevent
// privilege escalation. A safety guard prevents removing the last admin.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireAdmin, auditLog } from "../_shared/db.ts";

// Roles that may be assigned from the back-office UI.
const ASSIGNABLE = ["admin", "super_admin", "staff", "operator", "viewer"] as const;
type Assignable = (typeof ASSIGNABLE)[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  const adminId = await requireAdmin(req, db);
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
      if (error) return json({ ok: false, error: error.message }, 500);

      const ids = list.users.map((u) => u.id);
      const { data: roleRows } = await db.from("user_roles").select("user_id, role").in("user_id", ids);
      const { data: profiles } = await db.from("profiles").select("id, display_name, phone").in("id", ids);

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
      // Unique(user_id, role) → ignore duplicates gracefully.
      const { error } = await db.from("user_roles").insert({ user_id: userId, role });
      if (error && !String(error.message).toLowerCase().includes("duplicate")) {
        return json({ ok: false, error: error.message }, 500);
      }
      await auditLog(db, { actor: adminId, action: "users.role.grant", target: userId, data: { role } });
      return json({ ok: true });
    }

    if (action === "remove_role") {
      if (!userId || !role) return json({ ok: false, error: "INVALID_ROLE" }, 400);

      // Safety: never allow removing the last privileged admin (lock-out guard).
      if (role === "admin" || role === "super_admin") {
        const { count } = await db.from("user_roles")
          .select("id", { count: "exact", head: true }).eq("role", role);
        if ((count ?? 0) <= 1) {
          return json({ ok: false, error: "LAST_ADMIN_PROTECTED" }, 409);
        }
      }
      const { error } = await db.from("user_roles").delete().eq("user_id", userId).eq("role", role);
      if (error) return json({ ok: false, error: error.message }, 500);
      await auditLog(db, { actor: adminId, action: "users.role.revoke", target: userId, data: { role } });
      return json({ ok: true });
    }

    if (action === "invite") {
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ ok: false, error: "INVALID_EMAIL" }, 400);
      }
      const redirectTo = `${req.headers.get("origin") ?? Deno.env.get("SUPABASE_URL")}/admin/reset-password`;
      const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error) return json({ ok: false, error: error.message }, 500);
      await auditLog(db, { actor: adminId, action: "users.invite", target: data.user?.id ?? null, data: { email } });
      return json({ ok: true, userId: data.user?.id ?? null });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
