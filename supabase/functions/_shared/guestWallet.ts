import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  type PassStudioPass,
  issuePassStudioPass,
  requirePassStudioApiKey,
  resolvePassStudioPass,
  updatePassStudioInstance,
} from "./passStudio.ts";

export type GuestWalletRental = {
  id: string;
  customer_segment?: string | null;
  customer_email?: string | null;
  customer_language?: string | null;
};

function normalizeFieldKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstEditableField(pass: PassStudioPass, aliases: string[]) {
  const templateOwned = new Set((pass.templateOwnedFieldKeys ?? []).map(normalizeFieldKey));
  const aliasSet = new Set(aliases.map(normalizeFieldKey));
  return (pass.fieldKeys ?? []).find((key) => {
    const normalized = normalizeFieldKey(key);
    return aliasSet.has(normalized) && !templateOwned.has(normalized);
  });
}

export function guestPresentationFields(pass: PassStudioPass, presentation: unknown) {
  const source = presentation && typeof presentation === "object"
    ? (presentation as Record<string, unknown>).fields
    : null;
  const values = source && typeof source === "object" ? source as Record<string, unknown> : {};
  const fields: Record<string, string | number | boolean | null> = {};
  const assign = (aliases: string[], value: unknown) => {
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return;
    const key = firstEditableField(pass, aliases);
    if (key && fields[key] === undefined) fields[key] = value as string | number | boolean | null;
  };

  assign(["status", "rental_status", "rentalStatus", "tier", "level", "niveau", "statut"], values.status ?? values.tier);
  assign(["current_price", "currentPrice", "price", "current_cost", "currentCost", "cost", "prix", "montant"], values.current_price ?? values.price);
  assign(["rental_reference", "rentalReference", "reference", "ref", "location_reference"], values.rental_reference ?? values.reference);
  assign(["station", "station_id", "stationId", "borne"], values.station);
  assign(["started_at", "startedAt", "start_time", "startTime", "depart"], values.started_at);

  // A single editable status/tier field is sufficient for V1 because it carries
  // the canonical state and exact current price (e.g. "Location · CHF 3.90").
  if (Object.keys(fields).length === 0) throw new Error("PASS_STUDIO_EXPRESS_FIELDS_NOT_EDITABLE");
  return fields;
}

export async function guestEmailHash(email: string) {
  const normalized = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function guestWalletEnabled(db: SupabaseClient) {
  const { data, error } = await db.from("app_settings").select("value").eq("key", "guest_wallet.express").maybeSingle();
  if (error) return false;
  const value = data?.value;
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).enabled === true);
}

export async function resolveExpressPass(apiKey: string) {
  return await resolvePassStudioPass(apiKey, {
    passId: (Deno.env.get("PASS_STUDIO_EXPRESS_PASS_ID") ?? "").trim(),
    passName: (Deno.env.get("PASS_STUDIO_EXPRESS_PASS_NAME") ?? "Chargeurs Express").trim(),
    allowSoleActiveFallback: false,
  });
}

export async function getGuestWalletForRental(db: SupabaseClient, rentalId: string) {
  const { data: link, error: linkError } = await db.from("guest_wallet_rental_links")
    .select("guest_wallet_pass_id")
    .eq("rental_id", rentalId)
    .maybeSingle();
  if (linkError || !link?.guest_wallet_pass_id) return null;

  const { data: wallet, error: walletError } = await db.from("guest_wallet_passes")
    .select("id,status,provider,provider_pass_id,provider_instance_id,provider_holder_id,provider_add_to_wallet_url,pass_revision")
    .eq("id", link.guest_wallet_pass_id)
    .eq("status", "active")
    .maybeSingle();
  if (walletError) return null;
  return wallet;
}

export async function ensureGuestWalletPass(db: SupabaseClient, rental: GuestWalletRental) {
  if (String(rental.customer_segment ?? "") !== "guest") throw new Error("GUEST_WALLET_GUEST_ONLY");
  const email = String(rental.customer_email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("GUEST_WALLET_EMAIL_PENDING");
  if (!(await guestWalletEnabled(db))) throw new Error("GUEST_WALLET_NOT_ENABLED");

  const apiKey = requirePassStudioApiKey();
  const providerPass = await resolveExpressPass(apiKey);
  const emailHash = await guestEmailHash(email);
  const { data: presentation, error: presentationError } = await db.rpc("guest_wallet_presentation_state", { p_rental_id: rental.id });
  if (presentationError) throw new Error("GUEST_WALLET_PRESENTATION_UNAVAILABLE");
  const fields = guestPresentationFields(providerPass, presentation);

  const { data: existing, error: existingError } = await db.from("guest_wallet_passes")
    .select("*")
    .eq("email_hash", emailHash)
    .eq("status", "active")
    .maybeSingle();
  if (existingError) throw new Error("GUEST_WALLET_LOOKUP_FAILED");

  let instanceId = String(existing?.provider_instance_id ?? "").trim();
  let holderId = String(existing?.provider_holder_id ?? "").trim();
  let addToWalletUrl = String(existing?.provider_add_to_wallet_url ?? "").trim();
  let barcodeContent = String(existing?.provider_barcode_content ?? "").trim();
  const providerMatches = String(existing?.provider_pass_id ?? "") === providerPass.passId;
  let alreadyExisted = Boolean(instanceId && providerMatches);

  if (!instanceId || !providerMatches || !addToWalletUrl) {
    const issued = await issuePassStudioPass(apiKey, providerPass, { email, fields });
    instanceId = issued.instanceId;
    holderId = issued.passstudioHolderId;
    addToWalletUrl = issued.addToWalletUrl;
    barcodeContent = issued.barcodeContent;
    alreadyExisted = Boolean(issued.alreadyExisted);
  }

  if (!instanceId || !addToWalletUrl) throw new Error("PASS_STUDIO_EXPRESS_ISSUE_RESPONSE_INVALID");

  // Issue dedupe hits do not apply fields, so always publish canonical current state.
  await updatePassStudioInstance(apiKey, providerPass, instanceId, fields);
  const now = new Date().toISOString();
  const { data: wallet, error: upsertError } = await db.from("guest_wallet_passes").upsert({
    email_hash: emailHash,
    status: "active",
    provider: "pass_studio",
    provider_status: "issued",
    provider_pass_id: providerPass.passId,
    provider_instance_id: instanceId,
    provider_holder_id: holderId || null,
    provider_barcode_content: barcodeContent || null,
    provider_add_to_wallet_url: addToWalletUrl,
    provider_last_error_code: null,
    current_rental_id: rental.id,
    last_synced_at: now,
    updated_at: now,
  }, { onConflict: "email_hash" }).select("id,pass_revision").single();
  if (upsertError || !wallet) throw new Error("GUEST_WALLET_PERSIST_FAILED");

  await db.from("guest_wallet_passes").update({
    pass_revision: Number(wallet.pass_revision ?? 0) + 1,
    updated_at: now,
  }).eq("id", wallet.id);

  const { error: linkError } = await db.from("guest_wallet_rental_links").upsert({
    rental_id: rental.id,
    guest_wallet_pass_id: wallet.id,
    linked_at: now,
  }, { onConflict: "rental_id" });
  if (linkError) throw new Error("GUEST_WALLET_LINK_FAILED");

  return { addToWalletUrl, instanceId, alreadyExisted, walletId: String(wallet.id) };
}
