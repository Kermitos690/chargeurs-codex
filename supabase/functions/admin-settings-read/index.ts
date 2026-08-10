// admin-settings-read — read-only back-office settings projection.
// Keeps React pages away from table-specific RLS differences while exposing no
// secrets and no mutation surface.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireRoles } from "../_shared/db.ts";

const READ_ROLES = ["super_admin", "admin", "operations_admin", "operator"] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const userId = await requireRoles(req, db, READ_ROLES);
  if (!userId) return json({ ok: false, error: "FORBIDDEN" }, 403);

  const { data, error } = await db
    .from("kiosk_settings")
    .select("key,value")
    .eq("key", "default_language")
    .maybeSingle();
  if (error) return json({ ok: false, error: "SETTINGS_READ_FAILED" }, 500);

  const value = data?.value && typeof data.value === "object"
    ? (data.value as Record<string, unknown>).value
    : null;
  const language = ["fr", "en", "de"].includes(String(value)) ? String(value) : "fr";

  return json({ ok: true, defaultLanguage: language });
});
