import type { SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { auditLog } from "./db.ts";
import {
  PassStudioError,
  type PassStudioPass,
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

function accountDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-CH", { dateStyle: "medium", timeStyle: "short" });
}

function isoDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function safeProviderError(error: unknown) {
  if (error instanceof PassStudioError) {
    const status = error.status === 401 || error.status === 403 ? 503 : error.status;
    return { status, code: error.code };
  }
  return { status: 502, code: "PASS_STUDIO_UNAVAILABLE" };
}

function normalizeFieldKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function firstEditableField(pass: PassStudioPass, aliases: string[]) {
  const templateOwned = new Set((pass.templateOwnedFieldKeys ?? []).map(normalizeFieldKey));
  const aliasSet = new Set(aliases.map(normalizeFieldKey));
  return (pass.fieldKeys ?? []).find((key) => {
    const normalized = normalizeFieldKey(key);
    return aliasSet.has(normalized) && !templateOwned.has(normalized);
  });
}

function buildChargeursPassFields(
  pass: PassStudioPass,
  values: {
    membershipName: string;
    membershipStatus: string;
    memberRate: string;
    dailyCap: string;
    chargePoints: number;
    renewalCredit: string | null;
    nextDateLabel: "Prochaine échéance" | "Fin de l’adhésion";
    nextDateDisplay: string;
    nextDateIso: string | null;
  },
) {
  const fields: Record<string, string | number | boolean | null> = {};
  const assign = (aliases: string[], value: string | number | boolean | null) => {
    const key = firstEditableField(pass, aliases);
    if (key && fields[key] === undefined) fields[key] = value;
  };

  const offerDetails = `Tarif membre : ${values.memberRate} · Plafond journalier : ${values.dailyCap}`;
  const conditions = [
    `Statut adhésion : ${values.membershipStatus}`,
    values.renewalCredit ? `Crédit adhésion / renouvellement : ${values.renewalCredit}` : null,
    `${values.nextDateLabel} : ${values.nextDateDisplay}`,
  ].filter(Boolean).join(" · ");

  assign(["chargepoints", "charge_points", "points", "points_balance", "pointsBalance", "loyalty_points", "solde_points", "solde_de_points"], values.chargePoints);
  assign(["membership_name", "membership_level", "tier", "level", "niveau"], values.membershipName);
  assign(["offer_details", "offerDetails", "details_offer", "details_de_loffre", "details_de_l_offre", "benefits", "avantages"], offerDetails);
  assign(["conditions", "terms", "terms_conditions", "termsAndConditions", "conditions_offre", "conditions_de_loffre"], conditions);
  assign(["valid_until", "expiry", "expiration", "offer_expiry", "offerExpiry", "offer_expiration", "expires_at", "expiration_offre"], values.nextDateIso);

  assign(["membership_status", "status_membre"], values.membershipStatus);
  assign(["member_rate", "tarif_membre"], values.memberRate);
  assign(["daily_cap", "plafond_journalier"], values.dailyCap);
  assign(["renewal_credit", "credit_adhesion_renouvellement"], values.renewalCredit);
  assign(["next_due", "prochaine_echeance", "membership_end", "fin_adhesion"], values.nextDateDisplay);

  return fields;
}

function applyRealtimePresentation(
  pass: PassStudioPass,
  fields: Record<string, string | number | boolean | null>,
  presentation: unknown,
) {
  if (!presentation || typeof presentation !== "object") return fields;
  const rawFields = (presentation as Record<string, unknown>).fields;
  if (!rawFields || typeof rawFields !== "object") return fields;

  for (const [sourceKey, rawValue] of Object.entries(rawFields as Record<string, unknown>)) {
    if (rawValue !== null && typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") continue;
    const providerKey = firstEditableField(pass, [sourceKey]);
    if (providerKey) fields[providerKey] = rawValue as string | number | boolean | null;
  }
  return fields;
}

export async function handlePassStudioWallet(
  db: SupabaseClient,
  user: User,
  action: WalletAction,
): Promise<PassStudioWalletResult> {
  if (!user.email) return { ok: false, status: 401, body: { ok: false, error: "VERIFIED_ACCOUNT_REQUIRED" } };

  const [membershipResult, profileResult, pointsResult, walletResult] = await Promise.all([
    db.from("customer_memberships")
      .select("id,status,renews_at,ends_at,cancel_at_period_end,stripe_current_period_end,customer_membership_plans(id,name,currency,renewal_credit_cents,hourly_cents,daily_cap_cents)")
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
    return { ok: false, status: 500, body: { ok: false, error: "WALLET_SOURCE_DATA_UNAVAILABLE" } };
  }
  const membership = membershipResult.data;
  if (!membership) return { ok: false, status: 409, body: { ok: false, error: "ACTIVE_MEMBERSHIP_REQUIRED" } };

  const rawPlan = membership.customer_membership_plans;
  const plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;
  if (!plan) return { ok: false, status: 409, body: { ok: false, error: "MEMBERSHIP_PLAN_UNAVAILABLE" } };

  const existing = walletResult.data as Record<string, unknown> | null;
  const now = new Date().toISOString();
  const recordProviderFailure = async (code: string, stage: "configuration" | "template" | "issuance") => {
    if (existing?.id) {
      await db.from("customer_wallet_passes").update({
        provider: "pass_studio",
        provider_status: "error",
        provider_last_error_code: code,
        updated_at: now,
      }).eq("id", String(existing.id));
    }
    await auditLog(db, {
      actor: user.id,
      action: "wallet.pass_provider_failed",
      target: membership.id,
      data: { provider: "pass_studio", code, stage },
    });
  };

  let apiKey: string;
  try {
    apiKey = requirePassStudioApiKey();
  } catch (error) {
    const providerError = safeProviderError(error);
    await recordProviderFailure(providerError.code, "configuration");
    return { ok: false, status: providerError.status, body: { ok: false, error: providerError.code } };
  }

  const currency = String(plan.currency ?? "CHF");
  const memberRate = `${cents(Number(plan.hourly_cents ?? 0), currency)} / h`;
  const dailyCap = `${cents(Number(plan.daily_cap_cents ?? 0), currency)} / jour`;
  const renewalCreditCents = Number(plan.renewal_credit_cents ?? 0);
  const renewalCredit = renewalCreditCents > 0 ? cents(renewalCreditCents, currency) : null;
  const cancellationScheduled = Boolean(membership.cancel_at_period_end);
  const periodEnd = membership.stripe_current_period_end ?? membership.ends_at ?? null;
  const nextDateRaw = cancellationScheduled ? periodEnd : membership.renews_at;
  const nextDateLabel = cancellationScheduled ? "Fin de l’adhésion" : "Prochaine échéance";
  const nextDateDisplay = accountDate(nextDateRaw);
  const nextDateIso = isoDate(nextDateRaw);

  let providerPass: PassStudioPass;
  try {
    providerPass = await resolvePassStudioPass(apiKey);
  } catch (error) {
    const providerError = safeProviderError(error);
    await recordProviderFailure(providerError.code, "template");
    return { ok: false, status: providerError.status, body: { ok: false, error: providerError.code } };
  }

  const fields = buildChargeursPassFields(providerPass, {
    membershipName: String(plan.name ?? "Chargeurs+"),
    membershipStatus: String(membership.status ?? "active"),
    memberRate,
    dailyCap,
    chargePoints: Number(pointsResult.data?.balance ?? 0),
    renewalCredit,
    nextDateLabel,
    nextDateDisplay,
    nextDateIso,
  });

  const { data: realtimePresentation, error: realtimePresentationError } = await db.rpc(
    "customer_wallet_presentation_state",
    { p_user_id: user.id },
  );
  if (realtimePresentationError) {
    return { ok: false, status: 500, body: { ok: false, error: "WALLET_PRESENTATION_UNAVAILABLE" } };
  }
  applyRealtimePresentation(providerPass, fields, realtimePresentation);

  const existingInstanceId = String(existing?.provider_instance_id ?? "").trim();

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
      await recordProviderFailure("PASS_STUDIO_ISSUE_RESPONSE_INVALID", "issuance");
      return { ok: false, status: 502, body: { ok: false, error: "PASS_STUDIO_ISSUE_RESPONSE_INVALID" } };
    }

    if (Object.keys(fields).length > 0) {
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
        updated_fields: Object.keys(fields),
        realtime_presentation: true,
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
    await recordProviderFailure(providerError.code, "issuance");
    return { ok: false, status: providerError.status, body: { ok: false, error: providerError.code } };
  }
}
