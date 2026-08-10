// pricing-admin-read — read/simulate-only pricing projection for finance/support.
// Mutations remain in pricing-admin and keep their narrower finance write roles.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireRoles, auditLog } from "../_shared/db.ts";

const READ_ROLES = [
  "super_admin", "admin", "finance_admin", "operations_admin",
  "support_agent", "staff", "viewer",
] as const;

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

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  try {
    if (action === "list") {
      const { data: profiles, error: profileError } = await db.from("price_profiles")
        .select("*").order("priority", { ascending: false }).order("name");
      if (profileError) throw profileError;
      const { data: assigns, error: assignmentError } = await db.from("price_assignments")
        .select("price_profile_id,scope,active").eq("active", true);
      if (assignmentError) throw assignmentError;
      const counts: Record<string, { station: number; shop: number; device: number }> = {};
      for (const a of assigns ?? []) {
        const c = counts[a.price_profile_id] ??= { station: 0, shop: 0, device: 0 };
        if (a.scope in c) (c as Record<string, number>)[a.scope]++;
      }
      return json({ ok: true, profiles: (profiles ?? []).map((p) => ({ ...p, counts: counts[p.id] ?? { station: 0, shop: 0, device: 0 } })) });
    }

    if (action === "get") {
      const id = String(body.id ?? "");
      if (!id) return json({ ok: false, error: "INVALID_ID" }, 400);
      const { data: profile, error: profileError } = await db.from("price_profiles").select("*").eq("id", id).maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return json({ ok: false, error: "NOT_FOUND" }, 404);
      const [versions, assignments, rentals, logs] = await Promise.all([
        db.from("price_profile_versions").select("*").eq("price_profile_id", id).order("version", { ascending: false }),
        db.from("price_assignments").select("*").eq("price_profile_id", id).order("scope"),
        db.from("rental_sessions").select("id,station_id,state,amount_expected,currency,created_at,pricing_snapshot_hash").eq("price_profile_id", id).order("created_at", { ascending: false }).limit(20),
        db.from("audit_logs").select("action,actor,created_at,target").eq("target", id).order("created_at", { ascending: false }).limit(50),
      ]);
      for (const result of [versions, assignments, rentals, logs]) if (result.error) throw result.error;
      return json({ ok: true, profile, versions: versions.data ?? [], assignments: assignments.data ?? [], rentals: rentals.data ?? [], logs: logs.data ?? [] });
    }

    if (action === "simulate") {
      const { data, error } = await db.rpc("compute_pricing", {
        p_device: body.device ?? null,
        p_station: body.station ?? null,
        p_shop: body.shop ?? null,
        p_start: body.start ?? new Date().toISOString(),
        p_end: body.end ?? null,
        p_rental_state: body.rental_state ?? "active",
        p_return_state: body.return_state ?? "normal",
        p_currency: body.currency ?? null,
      });
      if (error) return json({ ok: false, error: String(error.message ?? error) }, 409);
      await auditLog(db, {
        actor: userId,
        action: "pricing.simulated",
        target: String(data?.profile_id ?? ""),
        data: { station: body.station ?? null, device: body.device ?? null, final_cents: data?.final_cents ?? null },
      });
      return json({ ok: true, snapshot: data });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("pricing-admin-read", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return json({ ok: false, error: "PRICING_READ_FAILED" }, 500);
  }
});
