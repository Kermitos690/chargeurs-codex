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

function text(value: unknown, max = 4000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function requireSuperAdmin(req: Request, db: ReturnType<typeof adminClient>) {
  const authorization = req.headers.get("Authorization") ?? "";
  const jwt = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!jwt) return null;
  const { data: { user }, error } = await db.auth.getUser(jwt);
  if (error || !user) return null;
  const { data: roleRows, error: roleError } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (roleError || !(roleRows ?? []).some((row: { role: string }) => row.role === "super_admin")) return null;
  return user.id;
}

async function audit(db: ReturnType<typeof adminClient>, actor: string, action: string, target?: string, data?: Record<string, unknown>) {
  try {
    await db.from("audit_logs").insert({ actor, action, target: target ?? null, data: data ?? null });
  } catch (_) {
    // Audit logging must never turn a safe admin read/update into a platform outage.
  }
}

function throwIfError(result: { error: unknown }, label: string) {
  if (result.error) throw new Error(label);
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
    const body = await req.json().catch(() => ({}));
    const action = text(body.action, 64);

    if (action === "snapshot") {
      const [
        assets, locations, suppliers, contacts, sourceDocuments, capabilities, targetVenues,
        supplierProducts, offers, inquiries, inquiryItems, sparePartRequests,
        purchaseOrders, purchaseOrderLines, receipts, receiptLines,
        rmaCases, quarantineCases, defectCases, repairActions, batteries, slots,
      ] = await Promise.all([
        db.from("inventory_assets").select("id,asset_code,asset_type,source_system,source_external_id,manufacturer_serial,ownership_state,lifecycle_status,current_location_id,verification_state,last_observed_at,updated_at").order("asset_code"),
        db.from("inventory_locations").select("id,code,name,location_type,parent_location_id,external_station_id,slot_num,status,verification_state,updated_at").order("code"),
        db.from("inventory_suppliers").select("id,legal_name,trade_name,manufacturer_name,country_code,website,address,status,verification_state,notes,updated_at").order("legal_name"),
        db.from("inventory_supplier_contacts").select("id,supplier_id,contact_role,name,job_title,email,phone,messaging_handle,language,verification_state,notes,updated_at").order("contact_role"),
        db.from("inventory_source_documents").select("id,supplier_id,source_reference,source_type,title,original_filename,document_date,page_count,verification_state,notes,ingested_at").order("ingested_at", { ascending: false }),
        db.from("inventory_supplier_capabilities").select("*").order("capability_key"),
        db.from("inventory_supplier_target_venues").select("*").order("venue_key"),
        db.from("inventory_supplier_products").select("id,supplier_id,product_variant_id,supplier_sku,supplier_variant_key,supplier_product_name,catalog_section,source_page,procurement_mode,status,verification_state,notes,updated_at").order("supplier_variant_key"),
        db.from("inventory_supplier_offers").select("id,supplier_product_id,offer_key,quantity_label,quantity_min,quantity_max,configuration_label,unit_cost,currency,verification_state,notes,updated_at").order("created_at"),
        db.from("inventory_supplier_inquiries").select("id,supplier_id,inquiry_type,subject,sent_to,channel,status,external_message_id,external_thread_id,request_summary,contact_verification_state,sent_at,acknowledged_at,answered_at,closed_at,updated_at").order("created_at", { ascending: false }),
        db.from("inventory_supplier_inquiry_items").select("*").order("created_at"),
        db.from("inventory_spare_part_requests").select("id,supplier_id,inquiry_id,parent_supplier_product_id,component_category,requested_part_name,requested_for_supplier_skus,request_status,supplier_spare_sku,supplier_part_name,unit_cost,currency,moq,lead_time_days,compatibility_state,verification_state,response_notes,updated_at").order("component_category"),
        db.from("inventory_purchase_orders").select("id,supplier_id,po_number,status,currency,supplier_reference,incoterm,landed_cost_status,ordered_at,expected_at,cancelled_at,notes,updated_at").order("created_at", { ascending: false }),
        db.from("inventory_purchase_order_lines").select("*").order("created_at"),
        db.from("inventory_receipts").select("*").order("created_at", { ascending: false }),
        db.from("inventory_receipt_lines").select("*").order("created_at"),
        db.from("inventory_rma_cases").select("id,asset_id,defect_case_id,supplier_id,supplier_product_id,status,warranty_state,rma_reference,supplier_case_reference,opened_at,submitted_at,shipped_at,resolved_at,notes,updated_at").order("opened_at", { ascending: false }),
        db.from("inventory_quarantine_cases").select("id,asset_id,source,source_reason_code,status,verification_state,opened_at,released_at,release_reason,notes,updated_at").order("opened_at", { ascending: false }),
        db.from("inventory_defect_cases").select("id,asset_id,defect_category,severity,diagnostic_status,source,source_reason_code,verification_state,opened_at,diagnosed_at,resolved_at,diagnosis,notes,updated_at").order("opened_at", { ascending: false }),
        db.from("inventory_repair_actions").select("*").order("performed_at", { ascending: false }),
        db.from("batteries").select("battery_id,station_id,slot_num,status,power_level,qualification_status,quarantine_reason,updated_at").order("battery_id"),
        db.from("slots").select("station_id,slot_num,status,battery_id,updated_at").order("station_id").order("slot_num"),
      ]);

      const all = [assets, locations, suppliers, contacts, sourceDocuments, capabilities, targetVenues, supplierProducts, offers, inquiries, inquiryItems, sparePartRequests, purchaseOrders, purchaseOrderLines, receipts, receiptLines, rmaCases, quarantineCases, defectCases, repairActions, batteries, slots];
      const failure = all.find((result) => result.error);
      if (failure?.error) throw failure.error;

      return respond({
        ok: true,
        generatedAt: new Date().toISOString(),
        summary: {
          assets: assets.data?.length ?? 0,
          stations: assets.data?.filter((row) => row.asset_type === "station").length ?? 0,
          powerbanks: assets.data?.filter((row) => row.asset_type === "powerbank").length ?? 0,
          quarantines: quarantineCases.data?.filter((row) => row.status === "active").length ?? 0,
          suspectedDefects: defectCases.data?.filter((row) => row.diagnostic_status === "suspected").length ?? 0,
          suppliers: suppliers.data?.length ?? 0,
          supplierProducts: supplierProducts.data?.length ?? 0,
          offers: offers.data?.length ?? 0,
          openInquiries: inquiries.data?.filter((row) => !["answered", "closed"].includes(row.status)).length ?? 0,
          sparePartsPending: sparePartRequests.data?.filter((row) => row.request_status !== "answered").length ?? 0,
          purchaseOrders: purchaseOrders.data?.length ?? 0,
          receipts: receipts.data?.length ?? 0,
          rmaOpen: rmaCases.data?.filter((row) => row.status !== "resolved" && row.status !== "closed").length ?? 0,
        },
        assets: assets.data ?? [],
        locations: locations.data ?? [],
        suppliers: suppliers.data ?? [],
        contacts: contacts.data ?? [],
        sourceDocuments: sourceDocuments.data ?? [],
        capabilities: capabilities.data ?? [],
        targetVenues: targetVenues.data ?? [],
        supplierProducts: supplierProducts.data ?? [],
        offers: offers.data ?? [],
        inquiries: inquiries.data ?? [],
        inquiryItems: inquiryItems.data ?? [],
        sparePartRequests: sparePartRequests.data ?? [],
        purchaseOrders: purchaseOrders.data ?? [],
        purchaseOrderLines: purchaseOrderLines.data ?? [],
        receipts: receipts.data ?? [],
        receiptLines: receiptLines.data ?? [],
        rmaCases: rmaCases.data ?? [],
        quarantineCases: quarantineCases.data ?? [],
        defectCases: defectCases.data ?? [],
        repairActions: repairActions.data ?? [],
        runtimeBatteries: batteries.data ?? [],
        runtimeSlots: slots.data ?? [],
      });
    }

    if (action === "reconcile_runtime") {
      const rawStations = Array.isArray(body.stationIds) ? body.stationIds : [];
      const stationIds = [...new Set(rawStations.map((value: unknown) => text(value, 32)).filter(Boolean))].slice(0, 50);
      const hardwareResult = await db.rpc("inventory_reconcile_runtime_hardware", stationIds.length ? { p_station_ids: stationIds } : undefined);
      throwIfError(hardwareResult, "INVENTORY_HARDWARE_RECONCILIATION_FAILED");
      const quarantineResult = await db.rpc("inventory_reconcile_runtime_quarantines");
      throwIfError(quarantineResult, "INVENTORY_QUARANTINE_RECONCILIATION_FAILED");
      await audit(db, actor, "inventory.admin.runtime_reconciled", undefined, { station_ids: stationIds.length ? stationIds : "default" });
      return respond({ ok: true, hardware: hardwareResult.data, quarantines: quarantineResult.data });
    }

    if (action === "update_supplier") {
      const supplierId = text(body.supplierId, 64);
      const status = text(body.status, 24);
      const notes = text(body.notes, 8000);
      if (!supplierId || !["active", "inactive", "blocked"].includes(status)) {
        return respond({ ok: false, error: "INVALID_SUPPLIER_UPDATE" }, 400);
      }
      const { data, error } = await db.from("inventory_suppliers")
        .update({ status, notes: notes || null, updated_at: new Date().toISOString() })
        .eq("id", supplierId)
        .select("id,legal_name,trade_name,status,verification_state,notes,updated_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) return respond({ ok: false, error: "SUPPLIER_NOT_FOUND" }, 404);
      await audit(db, actor, "inventory.admin.supplier.updated", supplierId, { status });
      return respond({ ok: true, supplier: data });
    }

    if (action === "update_contact_notes") {
      const contactId = text(body.contactId, 64);
      const notes = text(body.notes, 8000);
      if (!contactId) return respond({ ok: false, error: "MISSING_CONTACT" }, 400);
      const { data, error } = await db.from("inventory_supplier_contacts")
        .update({ notes: notes || null, updated_at: new Date().toISOString() })
        .eq("id", contactId)
        .select("id,supplier_id,contact_role,name,email,phone,messaging_handle,verification_state,notes,updated_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) return respond({ ok: false, error: "CONTACT_NOT_FOUND" }, 404);
      await audit(db, actor, "inventory.admin.supplier_contact.updated", contactId);
      return respond({ ok: true, contact: data });
    }

    return respond({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("inventory-admin", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return respond({ ok: false, error: "INVENTORY_ADMIN_INTERNAL_ERROR" }, 500);
  }
});
