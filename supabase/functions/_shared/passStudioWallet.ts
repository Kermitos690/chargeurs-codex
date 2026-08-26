import type { SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { auditLog } from "./db.ts";
import {
  CHARGEURS_ACCOUNT_PASS_ID,
  PassStudioError,
  type PassStudioPass,
  issuePassStudioPass,
  requirePassStudioApiKey,
  resolvePassStudioPass,
} from "./passStudio.ts";

export type WalletAction = "issue" | "sync";
export type PassStudioWalletResult =
  | { ok: true; status: 200; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

function cents(value: number | null | undefined, currency = "CHF") {
  if (value == null) return "—";
  return new Intl.NumberFormat("fr-CH", { style: "currency", currency }).format(Number(value) / 100);
}

function normalize(value: string) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

function safeProviderError(error: unknown) {
  if (error instanceof PassStudioError) {
    return { status: error.status === 401 || error.status === 403 ? 503 : error.status, code: error.code };
  }
  return { status: 502, code: "PASS_STUDIO_UNAVAILABLE" };
}

function editableKeys(pass: PassStudioPass) {
  const owned = new Set(pass.templateOwnedFieldKeys ?? []);
  return (pass.fieldKeys ?? []).filter((key) => !owned.has(key));
}

function memberReference(membershipId: string) {
  return `CH+${membershipId.replace(/[^0-9a-f]/gi, "").slice(0, 12).toUpperCase()}`;
}

function buildFields(pass: PassStudioPass, input: {
  memberId: string;
  displayName: string;
  tierSummary: string;
  chargePoints: number;
  rentalCredit: string;
  memberRate: string;
  dailyCap: string;
  recentHistory: string;
}) {
  const fields: Record<string, string | number | boolean | null> = {};
  const aliases = (values: string[]) => values.map(normalize);
  for (const key of editableKeys(pass)) {
    // Custom Passes expose stable generated keys (for example `field_…`) and
    // their human-facing semantic labels separately. Prefer the provider label
    // for mapping while retaining the stable key in the PATCH payload.
    const normalized = normalize(pass.fieldLabels?.[key] ?? key);
    if (aliases(["memberId", "member_id", "membershipId"]).includes(normalized)) fields[key] = input.memberId;
    else if (aliases(["memberName", "member_name", "name", "holderName"]).includes(normalized) && input.displayName) fields[key] = input.displayName;
    else if (aliases(["points", "chargePoints", "charge_points"]).includes(normalized)) fields[key] = input.chargePoints;
    else if (aliases(["tier", "status", "statut", "membershipStatus"]).includes(normalized)) fields[key] = input.tierSummary;
    else if (aliases(["rentalCredit", "credit", "creditLocation", "balance", "solde"]).includes(normalized)) fields[key] = input.rentalCredit;
    else if (aliases(["memberRate", "tarifMembre", "rate", "hourlyRate"]).includes(normalized)) fields[key] = input.memberRate;
    else if (aliases(["dailyCap", "plafond", "plafondJournalier"]).includes(normalized)) fields[key] = input.dailyCap;
    else if (aliases(["recentHistory", "recentActivity", "historiqueRecent", "history", "activity", "latestUpdate", "latestUpdates"]).includes(normalized)) fields[key] = input.recentHistory;
  }
  return fields;
}

async function persistFailure(db: SupabaseClient, existing: Record<string, unknown> | null, code: string) {
  if (!existing?.id) return;
  await db.from("customer_wallet_passes").update({
    provider_status: "error",
    provider_last_error_code: code,
    updated_at: new Date().toISOString(),
  }).eq("id", String(existing.id));
}

export async function handlePassStudioWallet(
  db: SupabaseClient,
  user: User,
  action: WalletAction,
): Promise<PassStudioWalletResult> {
  if (!user.email) return { ok: false, status: 401, body: { ok: false, error: "VERIFIED_ACCOUNT_REQUIRED" } };

  const [membershipResult, profileResult, pointsResult, creditResult, walletResult, presentationResult] = await Promise.all([
    db.from("customer_memberships")
      .select("id,status,customer_membership_plans(id,name,currency,hourly_cents,daily_cap_cents)")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("profiles").select("display_name,phone").eq("id", user.id).maybeSingle(),
    db.from("customer_chargepoints_balances").select("balance").eq("user_id", user.id).maybeSingle(),
    db.from("customer_membership_credit_balances").select("balance_cents,currency").eq("user_id", user.id).eq("currency", "CHF").maybeSingle(),
    db.from("customer_wallet_passes").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.rpc("customer_wallet_presentation_state", { p_user_id: user.id }),
  ]);

  if (membershipResult.error || profileResult.error || pointsResult.error || creditResult.error || walletResult.error || presentationResult.error) {
    return { ok: false, status: 500, body: { ok: false, error: "WALLET_SOURCE_DATA_UNAVAILABLE" } };
  }
  const membership = membershipResult.data;
  if (!membership) return { ok: false, status: 409, body: { ok: false, error: "ACTIVE_MEMBERSHIP_REQUIRED" } };
  const rawPlan = membership.customer_membership_plans;
  const plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;
  if (!plan) return { ok: false, status: 409, body: { ok: false, error: "MEMBERSHIP_PLAN_UNAVAILABLE" } };

  const existing = walletResult.data as Record<string, unknown> | null;
  let apiKey: string;
  let providerPass: PassStudioPass;
  try {
    apiKey = requirePassStudioApiKey();
    providerPass = await resolvePassStudioPass(apiKey);
  } catch (error) {
    const pe = safeProviderError(error);
    await persistFailure(db, existing, pe.code);
    return { ok: false, status: pe.status, body: { ok: false, error: pe.code } };
  }

  if (providerPass.passId !== CHARGEURS_ACCOUNT_PASS_ID) {
    return { ok: false, status: 409, body: { ok: false, error: "PASS_STUDIO_ACCOUNT_PASS_REQUIRED" } };
  }

  const presentation = presentationResult.data && typeof presentationResult.data === "object"
    ? presentationResult.data as Record<string, unknown>
    : {};
  const pFields = presentation.fields && typeof presentation.fields === "object"
    ? presentation.fields as Record<string, unknown>
    : {};
  const currency = String(plan.currency ?? "CHF");
  const displayName = String(profileResult.data?.display_name ?? "");
  const sourceValues = {
    memberId: memberReference(String(membership.id)),
    displayName,
    rentalCredit: String(pFields.rental_credit ?? cents(Number(creditResult.data?.balance_cents ?? 0), String(creditResult.data?.currency ?? "CHF"))),
    tierSummary: String(pFields.tier ?? pFields.membership_status ?? membership.status ?? "Actif"),
    chargePoints: Number(pFields.points ?? pointsResult.data?.balance ?? 0),
    memberRate: `${cents(Number(plan.hourly_cents ?? 0), currency)} / h`,
    dailyCap: `${cents(Number(plan.daily_cap_cents ?? 0), currency)} / jour`,
    recentHistory: String(pFields.recent_history ?? pFields.historique_recent ?? presentation.recentHistory ?? "Aucune activité récente"),
  };
  const fields = buildFields(providerPass, sourceValues);

  const existingPassId = String(existing?.provider_pass_id ?? "").trim();
  const sameTemplate = existingPassId === providerPass.passId;
  let instanceId = sameTemplate ? String(existing?.provider_instance_id ?? "").trim() : "";
  let holderId = sameTemplate ? String(existing?.provider_holder_id ?? "").trim() : "";
  let barcode = sameTemplate ? String(existing?.provider_barcode_content ?? "").trim() : "";
  let addToWalletUrl = sameTemplate ? String(existing?.provider_add_to_wallet_url ?? "").trim() : "";
  let alreadyExisted = Boolean(instanceId);

  try {
    if (!instanceId) {
      const issued = await issuePassStudioPass(apiKey, providerPass, {
        email: user.email,
        name: displayName || null,
        phone: profileResult.data?.phone ?? null,
        fields,
      });
      instanceId = issued.instanceId;
      holderId = issued.passstudioHolderId;
      barcode = issued.barcodeContent;
      addToWalletUrl = issued.addToWalletUrl;
      alreadyExisted = Boolean(issued.alreadyExisted);
    }
    if (!instanceId || !addToWalletUrl) {
      await persistFailure(db, existing, "PASS_STUDIO_ISSUE_RESPONSE_INVALID");
      return { ok: false, status: 502, body: { ok: false, error: "PASS_STUDIO_ISSUE_RESPONSE_INVALID" } };
    }

    const now = new Date().toISOString();
    const patch = {
      membership_id: membership.id,
      status: "active",
      provider_status: "issued",
      provider: "pass_studio",
      provider_pass_id: providerPass.passId,
      provider_instance_id: instanceId,
      provider_holder_id: holderId || null,
      provider_barcode_content: barcode || null,
      provider_add_to_wallet_url: addToWalletUrl,
      provider_last_error_code: null,
      last_generated_at: now,
      last_synced_at: now,
      updated_at: now,
    };

    if (existing?.id) {
      const { error } = await db.from("customer_wallet_passes")
        .update({ ...patch, pass_revision: Number(existing.pass_revision ?? 0) + 1 })
        .eq("id", String(existing.id));
      if (error) return { ok: false, status: 500, body: { ok: false, error: "WALLET_PASS_PERSIST_FAILED" } };
    } else {
      const { error } = await db.from("customer_wallet_passes").insert({
        user_id: user.id,
        public_pass_id: crypto.randomUUID(),
        pass_revision: 1,
        token_version: 1,
        ...patch,
      });
      if (error) return { ok: false, status: 500, body: { ok: false, error: "WALLET_PASS_PERSIST_FAILED" } };
    }

    await auditLog(db, {
      actor: user.id,
      action: sameTemplate || action === "sync" ? "wallet.pass_synced" : "wallet.pass_issued",
      target: membership.id,
      data: {
        provider: "pass_studio",
        provider_pass_id: providerPass.passId,
        provider_instance_id: instanceId,
        previous_pass_id: existingPassId || null,
        already_existed: alreadyExisted,
        updated_fields: Object.keys(fields),
        provider_field_count: editableKeys(providerPass).length,
        provider_field_keys: editableKeys(providerPass),
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
        passId: providerPass.passId,
        passType: providerPass.passType ?? null,
        fieldCount: editableKeys(providerPass).length,
        fieldKeys: editableKeys(providerPass),
        alreadyExisted,
        syncedAt: now,
      },
    };
  } catch (error) {
    const pe = safeProviderError(error);
    await persistFailure(db, existing, pe.code);
    await auditLog(db, {
      actor: user.id,
      action: "wallet.pass_issue_failed",
      target: membership.id,
      data: { provider: "pass_studio", provider_pass_id: providerPass.passId, error: pe.code },
    });
    return { ok: false, status: pe.status, body: { ok: false, error: pe.code } };
  }
}
