// Legacy bootstrap helper. It is disabled by default and requires an internal
// secret even when explicitly enabled. Normal administration uses a controlled
// Auth invitation followed by a service-role role assignment.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const enabled = Deno.env.get("ADMIN_BOOTSTRAP_ENABLED") === "true";
  const expectedSecret = Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "";
  const providedSecret = req.headers.get("x-internal-function-secret") ?? "";
  if (!enabled || expectedSecret.length < 32 || !safeEqual(providedSecret, expectedSecret)) {
    return json({ ok: false, error: "ADMIN_BOOTSTRAP_DISABLED" }, 403);
  }
  const db = adminClient();

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);
  const { data: { user }, error } = await db.auth.getUser(authHeader.replace("Bearer ", ""));
  if (error || !user) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);

  const { count } = await db.from("user_roles").select("id", { count: "exact", head: true }).eq("role", "admin");
  if ((count ?? 0) > 0) {
    // An admin already exists. Tell the caller whether they are one.
    const { data: roles } = await db.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
    return json({ ok: isAdmin, alreadyBootstrapped: true, isAdmin });
  }

  await db.from("user_roles").insert({ user_id: user.id, role: "admin" });
  return json({ ok: true, granted: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
