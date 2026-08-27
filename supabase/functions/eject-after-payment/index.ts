// Chargeurs.ch post-payment release orchestrator.
// Safe supplier lane: exactly ONE ChargeNow O2 /rent/order/create WITH callback.
// Never send C3 /cabinet/ejectByRent after O2. Stripe/Terminal are not modified here.
// Each station must have its own successful O2-only physical qualification before release is enabled.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPPORTED_STATIONS = new Set(["DTA21269", "DTA21270", "DTA21277", "DTA22032"]);
const BASE = (Deno.env.get("CHARGENOW_API_BASE_URL") ?? "https://developer.chargenow.top/cdb-open-api/v1").replace(/\/$/, "");
const BASIC_AUTH = (Deno.env.get("CHARGENOW_BASIC_AUTH") ?? "").replace(/^Basic\s+/i, "").trim();
const BASIC_USER = Deno.env.get("CHARGENOW_BASIC_USERNAME") ?? "";
const BASIC_PASS = Deno.env.get("CHARGENOW_BASIC_PASSWORD") ?? "";
const CALLBACK_SECRET = Deno.env.get("CHARGENOW_CALLBACK_SECRET")
  ?? Deno.env.get("CHARGENOW_CALLBACK_SIGNING_KEY")
  ?? Deno.env.get("CHARGENOW_EVENT_SECRET")
  ?? "";
const encoder = new TextEncoder();

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function authHeader() {
  return BASIC_AUTH ? `Basic ${BASIC_AUTH}` : `Basic ${btoa(`${BASIC_USER}:${BASIC_PASS}`)}`;
}
function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function callbackToken(rentalId: string) {
  if (!CALLBACK_SECRET) throw new Error("CHARGENOW_CALLBACK_AUTH_NOT_CONFIGURED");
  const key = await crypto.subtle.importKey("raw", encoder.encode(CALLBACK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`chargeurs.ch:chargenow-callback:${rentalId}`));
  return base64Url(new Uint8Array(signature));
}
async function callbackUrl(rentalId: string) {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  if (!base) throw new Error("SUPABASE_INTERNAL_CONFIG_MISSING");
  const url = new URL("/functions/v1/chargenow-rent-callback", base);
  url.searchParams.set("token", await callbackToken(rentalId));
  return url.toString();
}

async function appendReleaseRequested(db: any, session: any) {
  const key = `release_requested:${session.id}`;
  const { data: existing } = await db.from("rental_orchestrator_events")
    .select("event_type").eq("rental_id", session.id).eq("idempotency_key", key).maybeSingle();
  if (existing) return;
  const { data: snap, error: snapError } = await db.from("rental_orchestrator_snapshots")
    .select("version,state").eq("rental_id", session.id).maybeSingle();
  if (snapError || !snap) throw new Error("ORCHESTRATOR_SNAPSHOT_MISSING");
  if (String(snap.state) !== "authorized") throw new Error(`ORCHESTRATOR_NOT_AUTHORIZED:${String(snap.state)}`);
  const { error } = await db.rpc("append_rental_orchestrator_event", {
    p_rental_id: session.id,
    p_expected_version: Number(snap.version ?? 0),
    p_event_type: "release_requested",
    p_idempotency_key: key,
    p_occurred_at: new Date().toISOString(),
    p_metadata: { source: "o2_callback_only", stationId: session.station_id, selectedSlotNum: session.selected_slot_num },
    p_resulting_state: "release_requested",
    p_payment_intent_id: session.stripe_payment_intent_id ?? null,
    p_station_id: session.station_id,
    p_battery_id: session.battery_id ?? null,
    p_final_amount_chf: null,
    p_failure_reason: null,
  });
  if (error && !String(error.message ?? "").includes("IDEMPOTENCY_KEY_CONFLICT")) throw error;
}

async function hasQualifiedO2OnlyProof(db: any, stationId: string): Promise<boolean> {
  const { data: logs, error: logError } = await db.from("api_logs")
    .select("request,response,created_at")
    .eq("service", "chargenow")
    .eq("endpoint", "/rent/order/create")
    .contains("request", { purpose: "o2_callback_only_operator_qualification", callback: true, deviceId: stationId })
    .order("created_at", { ascending: false })
    .limit(10);
  if (logError) throw logError;

  for (const log of logs ?? []) {
    const request = log?.request && typeof log.request === "object" ? log.request : {};
    const response = log?.response && typeof log.response === "object" ? log.response : {};
    const rentalSessionId = typeof request.rentalSessionId === "string" ? request.rentalSessionId : "";
    const tradeNo = typeof response.tradeNo === "string" ? response.tradeNo : "";
    if (!/^[0-9a-f-]{36}$/i.test(rentalSessionId) || !tradeNo) continue;

    const { data: session, error: sessionError } = await db.from("rental_sessions")
      .select("id,state,station_id,selected_slot_num,battery_id,apifox_trade_no")
      .eq("id", rentalSessionId).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session || session.state !== "completed" || session.station_id !== stationId || String(session.apifox_trade_no ?? "") !== tradeNo) continue;

    const { data: attempt, error: attemptError } = await db.from("hardware_release_attempts")
      .select("result,released_slot_nums,released_battery_ids")
      .eq("rental_session_id", rentalSessionId).maybeSingle();
    if (attemptError) throw attemptError;
    const slots = Array.isArray(attempt?.released_slot_nums) ? attempt.released_slot_nums.map(Number) : [];
    const batteries = Array.isArray(attempt?.released_battery_ids) ? attempt.released_battery_ids.map(String) : [];
    const exactSingle = attempt?.result === "single_release"
      && slots.length === 1
      && batteries.length === 1
      && slots[0] === Number(session.selected_slot_num)
      && batteries[0] === String(session.battery_id ?? "");
    if (!exactSingle) continue;

    const { count: c3Count, error: c3Error } = await db.from("api_logs")
      .select("id", { count: "exact", head: true })
      .eq("service", "chargenow")
      .eq("endpoint", "/cabinet/ejectByRent")
      .contains("request", { tradeNo });
    if (c3Error) throw c3Error;
    if ((c3Count ?? 0) === 0) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const caller = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!serviceRole || !safeEqual(caller, serviceRole)) return reply({ ok: false, error: "FORBIDDEN" }, 403);
  if ((Deno.env.get("CHARGENOW_MODE") ?? "test").trim().toLowerCase() !== "test") {
    return reply({ ok: false, error: "CHARGENOW_TEST_MODE_REQUIRED" }, 409);
  }
  if (!(BASIC_AUTH || (BASIC_USER && BASIC_PASS))) return reply({ ok: false, error: "CHARGENOW_NOT_CONFIGURED" }, 503);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceRole, { auth: { persistSession: false } });
  try {
    const body = await req.json().catch(() => ({}));
    const rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    if (!/^[0-9a-f-]{36}$/i.test(rentalSessionId)) return reply({ ok: false, error: "INVALID_RENTAL_ID" }, 400);

    const { data: session, error: sessionError } = await db.from("rental_sessions").select("*").eq("id", rentalSessionId).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return reply({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    const stationId = String(session.station_id ?? "").trim();
    const cabinetId = String(session.cabinet_id ?? stationId).trim();
    if (!SUPPORTED_STATIONS.has(stationId) || cabinetId !== stationId) {
      return reply({ ok: false, error: "O2_CALLBACK_ONLY_STATION_NOT_SUPPORTED", stationId }, 409);
    }
    if (!["authorized", "prepaid"].includes(String(session.settlement_status))) {
      return reply({ ok: false, error: "PAYMENT_NOT_CONFIRMED" }, 409);
    }
    const slotNum = Number(session.selected_slot_num);
    const batteryId = String(session.battery_id ?? "").trim();
    if (!Number.isInteger(slotNum) || slotNum < 1 || !batteryId) return reply({ ok: false, error: "RELEASE_IDENTITY_INCOMPLETE" }, 409);

    if (["ejected", "active_rental", "battery_taken", "battery_returned", "completed"].includes(String(session.state))) {
      return reply({ ok: true, alreadyDone: true, state: session.state });
    }
    if (session.state === "ejecting") {
      return reply({ ok: true, alreadyInProgress: true, state: "ejecting", mode: "o2_callback_only" }, 202);
    }
    if (session.state !== "payment_succeeded") return reply({ ok: false, error: "SESSION_NOT_RELEASABLE", state: session.state }, 409);

    // Every supported station remains fail-closed until its own O2-only physical proof exists.
    if (!(await hasQualifiedO2OnlyProof(db, stationId))) {
      return reply({ ok: false, error: "O2_CALLBACK_ONLY_PHYSICAL_PROOF_MISSING", stationId }, 409);
    }

    const { data: attempt, error: attemptError } = await db.from("hardware_release_attempts")
      .select("id,result,command_sent_at,selected_slot_num,expected_battery_id")
      .eq("rental_session_id", session.id).maybeSingle();
    if (attemptError) throw attemptError;
    if (!attempt || Number(attempt.selected_slot_num) !== slotNum || String(attempt.expected_battery_id ?? "") !== batteryId) {
      return reply({ ok: false, error: "RELEASE_BASELINE_MISSING_OR_MISMATCH" }, 409);
    }
    if (attempt.command_sent_at) {
      return reply({ ok: true, alreadyInProgress: true, state: "ejecting", mode: "o2_callback_only" }, 202);
    }

    await appendReleaseRequested(db, session);

    const commandSentAt = new Date().toISOString();
    const { data: locked, error: lockError } = await db.from("rental_sessions").update({
      state: "ejecting",
      chargenow_status: "o2_callback_only_command_started",
      failure_code: null,
      failure_message: "Commande unique O2 envoyée; vérification physique en cours.",
    }).eq("id", session.id).eq("state", "payment_succeeded").select("id");
    if (lockError) throw lockError;
    if (!locked?.length) return reply({ ok: true, alreadyInProgress: true, state: "ejecting" }, 202);

    const { error: attemptLockError } = await db.from("hardware_release_attempts").update({
      command_sent_at: commandSentAt,
      result: "command_sent",
      updated_at: commandSentAt,
    }).eq("id", attempt.id).is("command_sent_at", null);
    if (attemptLockError) throw attemptLockError;

    const cb = await callbackUrl(session.id);
    const endpoint = new URL(`${BASE}/rent/order/create`);
    endpoint.searchParams.set("deviceId", cabinetId);
    endpoint.searchParams.set("callbackURL", cb);

    let providerStatus = 0;
    let payload: any = null;
    let providerError: string | null = null;
    try {
      const response = await fetch(endpoint.toString(), {
        method: "POST",
        headers: { Accept: "application/json", Authorization: authHeader() },
        signal: AbortSignal.timeout(10_000),
      });
      providerStatus = response.status;
      const text = await response.text();
      try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 500) }; }
      const code = payload?.code;
      const businessOk = code === undefined ? response.ok : Number(code) === 0;
      if (!response.ok || !businessOk) providerError = `HTTP_${response.status}${code !== undefined ? `_CODE_${code}` : ""}`;
    } catch {
      providerError = "O2_PROVIDER_RESULT_AMBIGUOUS";
    }

    const tradeNo = payload?.data?.tradeNo ?? payload?.tradeNo ?? null;
    const orderId = payload?.data?.orderId ?? null;
    await db.from("api_logs").insert({
      service: "chargenow",
      endpoint: "/rent/order/create",
      method: "POST",
      status_code: providerStatus || null,
      request: { deviceId: cabinetId, rentalSessionId: session.id, purpose: "customer_o2_callback_only_release", callback: true, no_c3: true },
      response: { ok: !providerError, tradeNo, orderId },
      error: providerError,
    });

    const status = tradeNo
      ? "o2_callback_only_physical_reconciliation_pending"
      : "o2_result_ambiguous_physical_reconciliation_pending";
    const { error: updateError } = await db.from("rental_sessions").update({
      apifox_trade_no: tradeNo ?? session.apifox_trade_no,
      chargenow_order_id: orderId ?? session.chargenow_order_id,
      chargenow_status: status,
      failure_code: tradeNo ? null : "O2_RESULT_AMBIGUOUS",
      failure_message: tradeNo
        ? "Une seule commande fournisseur O2 a été envoyée; activation après réconciliation physique stricte."
        : "Le résultat fournisseur est ambigu; aucune seconde commande ne sera envoyée. Réconciliation physique en cours.",
    }).eq("id", session.id).eq("state", "ejecting");
    if (updateError) throw updateError;

    return reply({
      ok: true,
      state: "ejecting",
      mode: "o2_callback_only",
      stationId,
      tradeNo,
      confirmationPending: true,
      requiresPhysicalReconciliation: true,
      noSecondHardwareCommand: true,
    }, 202);
  } catch (error) {
    console.error("eject-after-payment", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "POST_PAYMENT_RELEASE_INTERNAL_ERROR" }, 500);
  }
});
