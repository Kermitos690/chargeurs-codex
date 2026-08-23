import type { SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { auditLog } from "./db.ts";
import {
  PassStudioError,
  issuePassStudioPass,
  requirePassStudioApiKey,
  resolvePassStudioPass,
  updatePassStudioInstance,
} from "./passStudio.ts";

export type WalletAction = "issue" | "sync";

export type PassStudioWalletResult =
  | { ok: true; status: 200; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

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

export async function handlePassStudioWallet(
  db: SupabaseClient,
  user: User,
  action: WalletAction,
): Promise<PassStudioWalletResult> {
  if (!user.email) return { ok: false, status: 401, body: { ok: false, error: "VERIFIED_ACCOUNT_REQUIRED" } };

  const [membershipResult, profileResult, pointsResult, walletResult] = await Promise.all([
    db.from("customer_memberships")
      .select("id,status,ends_at,stripe_current_period_end,customer_membership_plans(id,name,currency,hourly_cents,daily_cap_cents)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("profiles").select("display_name,phone").eq("id", user.id).maybeSingle(),
    db.from("customer_chargepoints_balances").select("balance").eq("user_id", user.id).maybeSingle(),
    db.from("customer_wallet_passes").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (membershipResult.error || profileResult.error || pointsResult.error || walletResult.error) {
    return { ok: false, status: 500, body: { ok: false, error: "WALLET_SOURCE_DATA_UNAVAILABLE" } };
  }
  const membership = membershipResult.data;
  if (!membership) return { ok: false, status: 409, body: { ok: false, error: "ACTIVE_MEMBERSHIP_REQUIRED" } };

  const rawPlan = membership.customer_membership_plans;
  const plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;
  if (!plan) return { ok: false, status: 409, body: { ok: false, error: "MEMBERSHIP_PLAN_UNAVAILABLE" } };

  let apiKey: string;
  try {
    apiKey = requirePassStudioApiKey();
  } catch (error) {
    const providerError = safeProviderError(error);
    return { ok: false, status: providerError.status, body: { ok: false, error: providerError.code } };
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
    return { ok: false, status: providerError.status, body: { ok: false, error: providerError.code } };
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
      return { ok: false, status: 502, body: { ok: false, error: "PASS_STUDIO_ISSUE_RESPONSE_INVALID" } };
    }

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
      if (updateError) return { ok: false, status: 500, body: { ok: false, error: "WALLET_PASS_PERSIST_FAILED" } };
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
      if (insertError) return { ok: false, status: 500, body: { ok: false, error: "WALLET_PASS_PERSIST_FAILED" } };
    }

    await auditLog(db, {
      actor: user.id,
      action: existingInstanceId || action === "sync" ? "wallet.pass_synced" : "wallet.pass_issued",
      target: membership.id,
      data: {
        provider: "pass_studio",
        provider_pass_id: providerPass.passId,
        provider_instance_id: instanceId,
        already_existed: alreadyExisted,
      },
    });

    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        provider: "pass_studio",
        status: "issued",
        addToWalletUrl,
        alreadyExisted,
        syncedAt: now,
      },
    };
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
    return { ok: false, status: providerError.status, body: { ok: false, error: providerError.code } };
  }
}
