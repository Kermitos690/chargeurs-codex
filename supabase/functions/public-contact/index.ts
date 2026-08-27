import { adminClient } from "../_shared/db.ts";
import { originAllowed, saltedIpHash, validatePublicContact } from "../_shared/publicContact.ts";
import { buildVoltSupportMessage, triageVoltMessage, validateVoltText, type VoltMode, type VoltServerContext } from "../_shared/voltGateway.ts";

function response(origin: string | null, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin ?? "null",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    },
  });
}

function normalizeStation(value: unknown): string | null {
  const station = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!station) return null;
  return /^[A-Z0-9_-]{4,32}$/.test(station) ? station : null;
}

function normalizeRentalId(value: unknown): string | null {
  const rentalId = typeof value === "string" ? value.trim() : "";
  if (!rentalId) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rentalId) ? rentalId : null;
}

async function requireVerifiedCustomer(req: Request, db: ReturnType<typeof adminClient>) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user || !user.email || !user.email_confirmed_at) return null;
  return user;
}

async function resolveClientContext(
  db: ReturnType<typeof adminClient>,
  userId: string,
  requestedRentalId: unknown,
  requestedStationId: unknown,
): Promise<{ ok: true; context: VoltServerContext } | { ok: false; code: string }> {
  const hasRequestedRental = typeof requestedRentalId === "string" && requestedRentalId.trim().length > 0;
  const rentalId = normalizeRentalId(requestedRentalId);
  if (hasRequestedRental && !rentalId) return { ok: false, code: "RENTAL_NOT_ACCESSIBLE" };

  let query = db.from("rental_sessions")
    .select("id,station_id,state,created_at")
    .eq("customer_user_id", userId);
  if (rentalId) query = query.eq("id", rentalId);
  else query = query.order("created_at", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, code: "ACCOUNT_CONTEXT_UNAVAILABLE" };
  if (rentalId && !data) return { ok: false, code: "RENTAL_NOT_ACCESSIBLE" };

  const station = data?.station_id ? String(data.station_id) : normalizeStation(requestedStationId);
  return {
    ok: true,
    context: {
      rentalId: data?.id ? String(data.id) : null,
      stationId: station,
      rentalState: data?.state ? String(data.state) : null,
    },
  };
}

async function rateLimited(db: ReturnType<typeof adminClient>, ipHash: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db.from("public_contact_requests")
    .select("id", { head: true, count: "exact" })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  return (count ?? 0) >= 5;
}

async function notifySuperAdmins(
  db: ReturnType<typeof adminClient>,
  requestId: string,
  triage: ReturnType<typeof triageVoltMessage>,
  context: VoltServerContext,
) {
  try {
    const { data: roleRows, error: roleError } = await db.from("user_roles").select("user_id").eq("role", "super_admin");
    if (roleError) return;
    const userIds = Array.from(new Set((roleRows ?? []).map((row: { user_id: string }) => row.user_id).filter(Boolean)));
    if (!userIds.length) return;
    const now = new Date().toISOString();
    await db.from("notifications").insert(userIds.map((userId) => ({
      user_id: userId,
      channel: "in_app",
      type: "volt_support_case",
      title: triage.priority === "high" ? "Dossier Volt prioritaire" : "Nouveau dossier Volt",
      body: `Dossier #${requestId.slice(0, 8)}${context.stationId ? ` · borne ${context.stationId}` : ""}`,
      data: {
        requestId,
        path: "/admin/support",
        category: triage.category,
        priority: triage.priority,
        stationId: context.stationId ?? null,
      },
      status: "sent",
      sent_at: now,
      idempotency_key: `volt-support:${requestId}:${userId}`,
      next_attempt_at: now,
    })));
  } catch {
    // Support case creation remains authoritative even if an admin alert cannot be queued.
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const configuredOrigins = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  if (!originAllowed(origin, configuredOrigins)) return response(null, { ok: false, error: "ORIGIN_FORBIDDEN" }, 403);
  if (req.method === "OPTIONS") return response(origin, { ok: true });
  if (req.method !== "POST") return response(origin, { ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const contentLength = Number(req.headers.get("Content-Length") ?? 0);
  if (contentLength > 16_384) return response(origin, { ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return response(origin, { ok: false, error: "INVALID_BODY" }, 400); }
  if (!payload || typeof payload !== "object") return response(origin, { ok: false, error: "INVALID_BODY" }, 400);

  const action = typeof payload.action === "string" ? payload.action : "legacy_contact";
  const db = adminClient();

  if (action === "volt_triage" || action === "volt_case") {
    const mode: VoltMode = payload.mode === "client" ? "client" : "public";
    const text = validateVoltText(payload.message);
    if (!text.ok) return response(origin, { ok: false, error: text.code }, 400);

    let customer: Awaited<ReturnType<typeof requireVerifiedCustomer>> = null;
    let context: VoltServerContext = { stationId: normalizeStation(payload.stationId) };
    if (mode === "client") {
      customer = await requireVerifiedCustomer(req, db);
      if (!customer) return response(origin, { ok: false, error: "VERIFIED_ACCOUNT_REQUIRED" }, 401);
      const resolved = await resolveClientContext(db, customer.id, payload.rentalId, payload.stationId);
      if (!resolved.ok) return response(origin, { ok: false, error: resolved.code }, resolved.code === "RENTAL_NOT_ACCESSIBLE" ? 403 : 503);
      context = resolved.context;
    }

    const triage = triageVoltMessage(text.value, context);
    if (action === "volt_triage") {
      return response(origin, { ok: true, triage, context: { rentalAttached: Boolean(context.rentalId), stationId: context.stationId ?? null } });
    }

    if (!triage.escalate) return response(origin, { ok: false, error: "CASE_NOT_REQUIRED", triage }, 409);

    const salt = Deno.env.get("PUBLIC_CONTACT_IP_HASH_SALT") ?? "";
    if (salt.length < 32) return response(origin, { ok: false, error: "NOT_CONFIGURED" }, 503);
    const forwarded = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    const ipHash = await saltedIpHash(forwarded, salt);
    if (await rateLimited(db, ipHash)) return response(origin, { ok: false, error: "RATE_LIMITED" }, 429);

    let name = "";
    let email = "";
    if (mode === "client" && customer) {
      email = customer.email ?? "";
      const { data: profile } = await db.from("profiles").select("display_name").eq("id", customer.id).maybeSingle();
      name = String(profile?.display_name ?? customer.user_metadata?.display_name ?? "Client Chargeurs.ch").trim().slice(0, 120);
      if (name.length < 2) name = "Client Chargeurs.ch";
    } else {
      name = typeof payload.name === "string" ? payload.name.trim().slice(0, 120) : "";
      email = typeof payload.email === "string" ? payload.email.trim().toLowerCase().slice(0, 254) : "";
    }

    const structuredMessage = buildVoltSupportMessage({ mode, text: text.value, triage, context });
    const validation = validatePublicContact({
      requestType: "support",
      locale: payload.locale,
      name,
      email,
      phone: "",
      organization: "",
      stationId: context.stationId ?? normalizeStation(payload.stationId) ?? "",
      message: structuredMessage,
      website: "",
    });
    if (!validation.ok) return response(origin, { ok: false, error: validation.code }, 400);

    const { data, error } = await db.from("public_contact_requests")
      .insert({ ...validation.value, ip_hash: ipHash })
      .select("id")
      .single();
    if (error || !data?.id) return response(origin, { ok: false, error: "REQUEST_NOT_RECORDED" }, 500);

    await notifySuperAdmins(db, String(data.id), triage, context);
    return response(origin, { ok: true, requestId: data.id, triage, provider: "deterministic", externalCall: false }, 201);
  }

  // Backward-compatible path for the existing public support/partner forms.
  const validation = validatePublicContact(payload);
  if (!validation.ok) return response(origin, { ok: false, error: validation.code }, 400);
  const salt = Deno.env.get("PUBLIC_CONTACT_IP_HASH_SALT") ?? "";
  if (salt.length < 32) return response(origin, { ok: false, error: "NOT_CONFIGURED" }, 503);
  const forwarded = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const ipHash = await saltedIpHash(forwarded, salt);
  if (await rateLimited(db, ipHash)) return response(origin, { ok: false, error: "RATE_LIMITED" }, 429);

  const { data, error } = await db.from("public_contact_requests")
    .insert({ ...validation.value, ip_hash: ipHash })
    .select("id")
    .single();
  if (error) return response(origin, { ok: false, error: "REQUEST_NOT_RECORDED" }, 500);
  return response(origin, { ok: true, requestId: data.id }, 201);
});
