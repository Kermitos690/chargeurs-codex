// pricing-admin — authoritative server-side admin API for the pricing engine.
// All mutations are role-gated (finance/admin) and audited. Read-only roles
// get read + simulate only. The frontend NEVER uses service_role directly.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, getCaller, auditLog } from "../_shared/db.ts";

const WRITE_ROLES = ["admin", "super_admin", "finance_admin"];
const READ_ROLES = [
  "admin", "super_admin", "finance_admin", "operations_admin",
  "support_agent", "operator", "viewer",
];

// Editable pricing fields (whitelist — never trust arbitrary client keys).
const FIELDS = [
  "name", "description", "currency", "active", "is_default", "valid_from", "valid_to",
  "priority", "chargenow_price_id", "shop_id", "period_label",
  "initial_fee_cents", "included_minutes", "period_minutes", "price_per_period_cents",
  "grace_minutes", "daily_cap_cents", "total_cap_cents", "max_amount_cents", "deposit_cents",
  "late_fee_cents", "unreturned_fee_cents", "unreturned_after_minutes", "min_amount_cents",
  "rounding", "tax_percent",
];

function pick(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (k in body) out[k] = body[k];
  return out;
}

function validate(p: Record<string, unknown>): string | null {
  const cents = [
    "initial_fee_cents", "price_per_period_cents", "grace_minutes", "daily_cap_cents",
    "total_cap_cents", "max_amount_cents", "deposit_cents", "late_fee_cents",
    "unreturned_fee_cents", "unreturned_after_minutes", "min_amount_cents", "included_minutes",
  ];
  for (const k of cents) {
    if (k in p && (typeof p[k] !== "number" || (p[k] as number) < 0 || !Number.isInteger(p[k] as number))) {
      return `${k} doit être un entier ≥ 0`;
    }
  }
  if ("period_minutes" in p && (typeof p.period_minutes !== "number" || (p.period_minutes as number) <= 0)) {
    return "period_minutes doit être > 0";
  }
  if ("tax_percent" in p && (typeof p.tax_percent !== "number" || (p.tax_percent as number) < 0)) {
    return "tax_percent doit être ≥ 0";
  }
  if ("rounding" in p && !["none", "up_5", "up_10"].includes(String(p.rounding))) {
    return "rounding invalide";
  }
  if ("name" in p && (!p.name || String(p.name).trim().length === 0)) return "Le nom est requis";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { userId, roles } = await getCaller(req, db);
    if (!userId || !roles.some((r) => READ_ROLES.includes(r))) return json({ ok: false, error: "FORBIDDEN" }, 403);
    const canWrite = roles.some((r) => WRITE_ROLES.includes(r));
    const body = await req.json();
    const action = String(body.action ?? "");

    // ---------- READ ----------
    if (action === "list") {
      const { data: profiles } = await db.from("price_profiles").select("*").order("priority", { ascending: false }).order("name");
      const { data: assigns } = await db.from("price_assignments").select("price_profile_id,scope,active").eq("active", true);
      const counts: Record<string, { station: number; shop: number; device: number }> = {};
      for (const a of assigns ?? []) {
        const c = counts[a.price_profile_id] ??= { station: 0, shop: 0, device: 0 };
        if (a.scope in c) (c as Record<string, number>)[a.scope]++;
      }
      return json({ ok: true, profiles: (profiles ?? []).map((p) => ({ ...p, counts: counts[p.id] ?? { station: 0, shop: 0, device: 0 } })) });
    }

    if (action === "get") {
      const id = String(body.id ?? "");
      const { data: profile } = await db.from("price_profiles").select("*").eq("id", id).maybeSingle();
      if (!profile) return json({ ok: false, error: "NOT_FOUND" }, 404);
      const { data: versions } = await db.from("price_profile_versions").select("*").eq("price_profile_id", id).order("version", { ascending: false });
      const { data: assignments } = await db.from("price_assignments").select("*").eq("price_profile_id", id).order("scope");
      const { data: rentals } = await db.from("rental_sessions").select("id,station_id,state,amount_expected,currency,created_at,pricing_snapshot_hash").eq("price_profile_id", id).order("created_at", { ascending: false }).limit(20);
      const { data: logs } = await db.from("audit_logs").select("*").eq("target", id).order("created_at", { ascending: false }).limit(50);
      return json({ ok: true, profile, versions: versions ?? [], assignments: assignments ?? [], rentals: rentals ?? [], logs: logs ?? [] });
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
      await auditLog(db, { actor: userId, action: "pricing.simulated", target: String(data?.profile_id ?? ""), data: { input: { device: body.device, station: body.station, shop: body.shop, end: body.end, return_state: body.return_state }, final_cents: data?.final_cents } });
      return json({ ok: true, snapshot: data });
    }

    // ---------- WRITE ----------
    if (!canWrite) return json({ ok: false, error: "FORBIDDEN_WRITE" }, 403);

    if (action === "create") {
      const p = pick(body);
      const err = validate(p); if (err) return json({ ok: false, error: err }, 400);
      p.updated_by = userId;
      const { data, error } = await db.from("price_profiles").insert(p).select().single();
      if (error) return json({ ok: false, error: error.message }, 400);
      await auditLog(db, { actor: userId, action: "pricing.profile.created", target: data.id, data: { new: data } });
      return json({ ok: true, profile: data });
    }

    if (action === "update") {
      const id = String(body.id ?? "");
      const { data: before } = await db.from("price_profiles").select("*").eq("id", id).maybeSingle();
      if (!before) return json({ ok: false, error: "NOT_FOUND" }, 404);
      const p = pick(body);
      const err = validate(p); if (err) return json({ ok: false, error: err }, 400);
      p.updated_by = userId;
      const { data, error } = await db.from("price_profiles").update(p).eq("id", id).select().single();
      if (error) return json({ ok: false, error: error.message }, 400);
      await auditLog(db, { actor: userId, action: "pricing.profile.updated", target: id, data: { old: before, new: data } });
      return json({ ok: true, profile: data });
    }

    if (action === "toggle") {
      const id = String(body.id ?? "");
      const active = Boolean(body.active);
      const { data, error } = await db.from("price_profiles").update({ active, updated_by: userId }).eq("id", id).select().single();
      if (error) return json({ ok: false, error: error.message }, 400);
      await auditLog(db, { actor: userId, action: active ? "pricing.profile.activated" : "pricing.profile.deactivated", target: id, data: { active } });
      return json({ ok: true, profile: data });
    }

    if (action === "setDefault") {
      const id = String(body.id ?? "");
      await db.from("price_profiles").update({ is_default: false }).neq("id", id);
      const { data, error } = await db.from("price_profiles").update({ is_default: true, updated_by: userId }).eq("id", id).select().single();
      if (error) return json({ ok: false, error: error.message }, 400);
      await auditLog(db, { actor: userId, action: "pricing.profile.set_default", target: id, data: {} });
      return json({ ok: true, profile: data });
    }

    if (action === "duplicate") {
      const id = String(body.id ?? "");
      const { data: src } = await db.from("price_profiles").select("*").eq("id", id).maybeSingle();
      if (!src) return json({ ok: false, error: "NOT_FOUND" }, 404);
      const copy = pick(src);
      copy.name = `${src.name} (copie)`;
      copy.is_default = false; copy.active = false; copy.updated_by = userId;
      const { data, error } = await db.from("price_profiles").insert(copy).select().single();
      if (error) return json({ ok: false, error: error.message }, 400);
      await auditLog(db, { actor: userId, action: "pricing.profile.duplicated", target: data.id, data: { from: id } });
      return json({ ok: true, profile: data });
    }

    if (action === "delete") {
      const id = String(body.id ?? "");
      const { count: rentalCount } = await db.from("rental_sessions").select("id", { count: "exact", head: true }).eq("price_profile_id", id);
      const { count: assignCount } = await db.from("price_assignments").select("id", { count: "exact", head: true }).eq("price_profile_id", id).eq("active", true);
      if ((rentalCount ?? 0) > 0 || (assignCount ?? 0) > 0) {
        return json({ ok: false, error: "HAS_DEPENDENCIES", rentals: rentalCount, assignments: assignCount }, 409);
      }
      const { error } = await db.from("price_profiles").delete().eq("id", id);
      if (error) return json({ ok: false, error: error.message }, 400);
      await auditLog(db, { actor: userId, action: "pricing.profile.deleted", target: id, data: {} });
      return json({ ok: true });
    }

    if (action === "assign") {
      const { price_profile_id, scope, scope_ref } = body;
      if (!price_profile_id || !["device", "station", "shop"].includes(scope) || !scope_ref) {
        return json({ ok: false, error: "INVALID_ASSIGNMENT" }, 400);
      }
      // Deactivate any existing active assignment for this scope_ref (one effective per scope target).
      await db.from("price_assignments").update({ active: false }).eq("scope", scope).eq("scope_ref", scope_ref).eq("active", true);
      const { data, error } = await db.from("price_assignments").insert({ price_profile_id, scope, scope_ref, active: true, created_by: userId }).select().single();
      if (error) return json({ ok: false, error: error.message }, 400);
      await auditLog(db, { actor: userId, action: "pricing.assigned", target: price_profile_id, data: { scope, scope_ref } });
      return json({ ok: true, assignment: data });
    }

    if (action === "unassign") {
      const id = String(body.assignment_id ?? "");
      const { data: a } = await db.from("price_assignments").select("*").eq("id", id).maybeSingle();
      const { error } = await db.from("price_assignments").delete().eq("id", id);
      if (error) return json({ ok: false, error: error.message }, 400);
      await auditLog(db, { actor: userId, action: "pricing.unassigned", target: a?.price_profile_id ?? id, data: { scope: a?.scope, scope_ref: a?.scope_ref } });
      return json({ ok: true });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
