// claim-admin — bootstrap helper. Grants 'admin' to the authenticated caller
// ONLY if no admin exists yet (first-come). Safe to expose: becomes a no-op
// once the first admin is set.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
