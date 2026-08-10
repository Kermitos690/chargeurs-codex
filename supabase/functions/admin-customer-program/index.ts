import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return json({ ok: false, error: "SERVER_CONFIG_MISSING" }, 503);

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);

  const { data: roles, error: roleError } = await db.from("user_roles").select("role").eq("user_id", user.id);
  if (roleError) return json({ ok: false, error: "ROLE_LOOKUP_FAILED" }, 500);
  const allowed = (roles ?? []).some((row: { role: string }) => ["super_admin", "admin", "operations_admin"].includes(row.role));
  if (!allowed) return json({ ok: false, error: "ADMIN_REQUIRED" }, 403);

  try {
    const [plans, memberships, passes, pointRules, pointLedger, promotions] = await Promise.all([
      db.from("customer_membership_plans")
        .select("id,code,name,currency,annual_fee_cents,renewal_credit_cents,hourly_cents,daily_cap_cents,billing_interval,billing_interval_count,included_minutes,discount_percent,active,valid_from,valid_to,updated_at")
        .order("active", { ascending: false }).order("name"),
      db.from("customer_memberships")
        .select("id,user_id,plan_id,status,starts_at,renews_at,ends_at,created_at,updated_at")
        .order("created_at", { ascending: false }).limit(200),
      db.from("customer_wallet_passes")
        .select("id,user_id,membership_id,status,provider_status,pass_revision,last_generated_at,last_synced_at,revoked_at,updated_at")
        .order("updated_at", { ascending: false }).limit(200),
      db.from("customer_chargepoints_rules")
        .select("id,code,name,event_type,fixed_points,points_per_chf,active,valid_from,valid_to,updated_at")
        .order("active", { ascending: false }).order("name"),
      db.from("customer_chargepoints_ledger")
        .select("id,user_id,delta,reason,source_type,source_id,created_at")
        .order("created_at", { ascending: false }).limit(100),
      db.from("customer_promotions")
        .select("id,code,name,partner_id,plan_id,audience,promotion_type,active,valid_from,valid_to,max_redemptions,max_redemptions_per_user,updated_at")
        .order("active", { ascending: false }).order("updated_at", { ascending: false }).limit(100),
    ]);

    for (const result of [plans, memberships, passes, pointRules, pointLedger, promotions]) {
      if (result.error) throw result.error;
    }

    const membershipRows = memberships.data ?? [];
    const passRows = passes.data ?? [];
    const ledgerRows = pointLedger.data ?? [];

    const membershipCounts = membershipRows.reduce<Record<string, number>>((acc, row: any) => {
      acc[String(row.status ?? "unknown")] = (acc[String(row.status ?? "unknown")] ?? 0) + 1;
      return acc;
    }, {});
    const passCounts = passRows.reduce<Record<string, number>>((acc, row: any) => {
      acc[String(row.provider_status ?? "unknown")] = (acc[String(row.provider_status ?? "unknown")] ?? 0) + 1;
      return acc;
    }, {});
    const pointsIssued = ledgerRows.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.delta ?? 0)), 0);

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      metrics: {
        memberships: membershipRows.length,
        membershipCounts,
        walletPasses: passRows.length,
        passCounts,
        activePointRules: (pointRules.data ?? []).filter((row: any) => row.active).length,
        recentPointsIssued: pointsIssued,
        activePromotions: (promotions.data ?? []).filter((row: any) => row.active).length,
      },
      plans: plans.data ?? [],
      memberships: membershipRows,
      passes: passRows,
      pointRules: pointRules.data ?? [],
      recentPointLedger: ledgerRows,
      promotions: promotions.data ?? [],
    });
  } catch (error) {
    console.error("admin-customer-program", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return json({ ok: false, error: "CUSTOMER_PROGRAM_UNAVAILABLE" }, 500);
  }
});
