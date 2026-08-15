import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

async function requireSuperAdmin(req: Request, db: ReturnType<typeof adminClient>) {
  const authorization = req.headers.get("Authorization") ?? "";
  const jwt = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!jwt) return null;
  const { data: { user }, error } = await db.auth.getUser(jwt);
  if (error || !user) return null;
  const { data: roleRows, error: roleError } = await db.from("user_roles").select("role").eq("user_id", user.id);
  if (roleError || !(roleRows ?? []).some((row: { role: string }) => row.role === "super_admin")) return null;
  return user.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method !== "POST") return respond({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const actor = await requireSuperAdmin(req, db);
  if (!actor) return respond({ ok: false, error: "SUPER_ADMIN_REQUIRED" }, 403);

  try {
    const [supplierProducts, offers] = await Promise.all([
      db.from("inventory_supplier_products")
        .select("id,supplier_id,product_variant_id,supplier_sku,supplier_variant_key,supplier_product_name,catalog_section,source_page,procurement_mode,status,verification_state,supplier_specifications,notes,updated_at")
        .order("catalog_section")
        .order("supplier_variant_key"),
      db.from("inventory_supplier_offers")
        .select("id,supplier_product_id,offer_key,quantity_label,quantity_min,quantity_max,configuration_label,unit_cost,currency,verification_state,notes,updated_at")
        .order("supplier_product_id")
        .order("quantity_min", { ascending: true, nullsFirst: true }),
    ]);
    if (supplierProducts.error) throw supplierProducts.error;
    if (offers.error) throw offers.error;

    return respond({
      ok: true,
      generatedAt: new Date().toISOString(),
      supplierProducts: supplierProducts.data ?? [],
      offers: offers.data ?? [],
    });
  } catch (error) {
    console.error("inventory-catalog", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return respond({ ok: false, error: "INVENTORY_CATALOG_INTERNAL_ERROR" }, 500);
  }
});
