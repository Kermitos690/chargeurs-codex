import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog } from "../_shared/db.ts";
import {
  PassStudioError,
  issuePassStudioPass,
  requirePassStudioApiKey,
  resolvePassStudioPass,
  updatePassStudioInstance,
} from "../_shared/passStudio.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function cents(centsValue: number | null | undefined, currency = "CHF") {
  if (centsValue == null) return "—";
  return new Intl.NumberFormat("fr-CH", { style: "currency", currency }).format(Number(centsValue) / 100);
}

function safeProviderError(error: unknown) {
  if (error instanceof PassStudioError) {
    const status = error.status === 401 || error.status === 403 ? 503 : error.status;
    return { status, code: error.code };
  }
  return { status: 502, code: "PASS_STUDIO_UNAVAILABLE" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user || !user.email || !user.email_confirmed_at) {
    return json({ ok: false, error: "VERIFIED_ACCOUNT_REQUIRED" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "issue");
  if (!["issue", "sync"].includes(action)) return json({ ok: false, error: "WALLET_ACTION_INVALID" }, 400);

  const [membershipResult, profileResult, pointsResult, walletResult] = await Promise.all([
    db.from("customer_memberships")
      .select("id,status,ends_at,stripe_current_period_end,customer_membership_plans(id,name,currency,hourly_cents,daily_cap_cents)")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("profiles").select("display_name,phone").eq("id", user.id).maybeSingle(),
    db.from("customer_chargepoints_balances").select("balance").eq("user_id", user.id).maybeSingle(),
    db.from("customer_wallet_passes").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (membershipResult.error || profileResult.error || pointsResult.error || walletResult.error) {
    return json({ ok: false, error: "WALLET_SOURCE_DATA_UNAVAILABLE" }, 500);
  }
  const membership = membershipResult.data;
  if (!membership) return json({ ok: false, error: "ACTIVE_MEMBERSHIP_REQUIRED" }, 409);

  const rawPlan = membership.customer_membership_plans;
  const plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;
  if (!plan) return json({ ok: false, error: "MEMBERSHIP_PLAN_UNAVAILABLE" }, 409);

  let apiKey: string;
  try {
    apiKey = requirePassStudioApiKey();
  } catch (error) {
    const providerError = safeProviderError(error);
    return json({ ok: false, error: providerError.code }, providerError.status);
  }

  const validUntil = membership.stripe_current_period_end ?? membership.ends_at ?? null;
  const fields: Record<string, string | number | boolean | null> = {
    membership_status: "Pass actif",
    membership_name: String(plan.name ?? "Chargeurs+"),
    member_rate: `${cents(Number(plan.hourly_cents ?? 0), String(plan.currency ?? "CHF"))} / h`,
    daily_cap: `${cents(Number(plan.daily_cap_cents ?? 0), String(plan.currency ?? "CHF"))} / jour`,
    chargepoints: Number(pointsResult.data?.balance ?? 0),
    valid_until: validUntil ? new Date(validUntil).toLocaleDateString("fr-CH") : "Actif",
  };

  let providerPass;
  try {
    providerPass = await resolvePassStudioPass(apiKey);
  } catch (error) {
    const providerError = safeProviderError(error);
    return json({ ok: false, error: providerError.code }, providerError.status);
  }

  const existing = walletResult.data as Record<string, unknown> | null;
  const existingInstanceId = String(existing?.provider_instance_id ?? "").trim();
  const now = new Date().toISOString();

  try {
    let instanceId = existingInstanceId;
    let holderId = String(existing?.provider_holder_id ?? "").trim();
    let barcodeContent = String(existing?.provider_barcode_content ?? "").trim();
    let addToWalletUrl = String(existing?.provider_add_to_wallet_url ?? "").trim();
    let alreadyExisted = Boolean(existingInstanceId);

    if (!instanceId) {
      const issued = await issuePassStudioPass(apiKey, providerPass, {
        email: user.email,
        name: profileResult.data?.display_name ?? null,
        phone: profileResult.data?.phone ?? null,
        fields,
      });
      instanceId = issued.instanceId;
      holderId = issued.passstudioHolderId;
      barcodeContent = issued.barcodeContent;
      addToWalletUrl = issued.addToWalletUrl;
      alreadyExisted = Boolean(issued.alreadyExisted);
    }

    if (!instanceId || !addToWalletUrl) {
      return json({ ok: false, error: "PASS_STUDIO_ISSUE_RESPONSE_INVALID" }, 502);
    }

    // Pass Studio documents that dedupe hits do not apply new fields. Always
    // sync the individual instance after issuance; this push is holder-scoped.
    if ((providerPass.fieldKeys ?? []).length > 0) {
      await updatePassStudioInstance(apiKey, providerPass, instanceId, fields);
    }

    const providerPatch = {
      membership_id: membership.id,
      status: "active",
      provider_status: "issued",
      provider: "pass_studio",
      provider_pass_id: providerPass.passId,
      provider_instance_id: instanceId,
      provider_holder_id: holderId || null,
      provider_barcode_content: barcodeContent || null,
      provider_add_to_wallet_url: addToWalletUrl,
      provider_last_error_code: null,
      last_generated_at: now,
      last_synced_at: now,
      updated_at: now,
    };

    if (existing?.id) {
      const { error: updateError } = await db.from("customer_wallet_passes").update({
        ...providerPatch,
        pass_revision: Number(existing.pass_revision ?? 0) + 1,
      }).eq("id", String(existing.id));
      if (updateError) return json({ ok: false, error: "WALLET_PASS_PERSIST_FAILED" }, 500);
    } else {
      const { error: insertError } = await db.from("customer_wallet_passes").insert({
        user_id: user.id,
        membership_id: membership.id,
        public_pass_id: crypto.randomUUID(),
        status: "active",
        provider_status: "issued",
        pass_revision: 1,
        token_version: 1,
        ...providerPatch,
      });
      if (insertError) return json({ ok: false, error: "WALLET_PASS_PERSIST_FAILED" }, 500);
    }

    await auditLog(db, {
      actor: user.id,
      action: existingInstanceId ? "wallet.pass_synced" : "wallet.pass_issued",
      target: membership.id,
      data: {
        provider: "pass_studio",
        provider_pass_id: providerPass.passId,
        provider_instance_id: instanceId,
        already_existed: alreadyExisted,
      },
    });

    return json({
      ok: true,
      provider: "pass_studio",
      status: "issued",
      addToWalletUrl,
      alreadyExisted,
      syncedAt: now,
    });
  } catch (error) {
    const providerError = safeProviderError(error);
    if (existing?.id) {
      await db.from("customer_wallet_passes").update({
        provider_status: "error",
        provider_last_error_code: providerError.code,
        updated_at: now,
      }).eq("id", String(existing.id));
    }
    await auditLog(db, {
      actor: user.id,
      action: "wallet.pass_provider_failed",
      target: membership.id,
      data: { provider: "pass_studio", code: providerError.code },
    });
    return json({ ok: false, error: providerError.code }, providerError.status);
  }
});
