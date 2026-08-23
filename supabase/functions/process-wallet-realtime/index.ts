import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  PassStudioError,
  requirePassStudioApiKey,
  resolvePassStudioPass,
  updatePassStudioInstance,
} from "../_shared/passStudio.ts";

const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

async function vaultSecret(db: ReturnType<typeof adminClient>, name: string) {
  const { data, error } = await db.rpc("internal_transactional_email_secret", { p_name: name });
  if (error) throw new Error(`WALLET_SECRET_${name.toUpperCase()}_UNAVAILABLE`);
  return String(data ?? "");
}

function providerError(error: unknown) {
  if (error instanceof PassStudioError) return { status: error.status, code: error.code };
  return { status: 502, code: "PASS_STUDIO_UNAVAILABLE" };
}

type OutboxRow = {
  id: string;
  user_id: string;
  attempts: number;
  expires_at: string | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const body = await req.json().catch(() => ({}));
  const expected = await vaultSecret(db, "customer_push_dispatch_key");
  if (!expected || String(body?.dispatchKey ?? "") !== expected) {
    return json({ ok: false, error: "FORBIDDEN" }, 403);
  }

  let apiKey: string;
  try {
    apiKey = requirePassStudioApiKey();
  } catch (error) {
    const failure = providerError(error);
    return json({ ok: false, error: failure.code }, failure.status === 401 || failure.status === 403 ? 503 : failure.status);
  }

  let providerPass;
  try {
    providerPass = await resolvePassStudioPass(apiKey);
  } catch (error) {
    const failure = providerError(error);
    return json({ ok: false, error: failure.code }, failure.status === 401 || failure.status === 403 ? 503 : failure.status);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const { data: dueRows, error: dueError } = await db
    .from("customer_wallet_sync_outbox")
    .select("id,user_id,attempts,expires_at")
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .order("created_at", { ascending: true })
    .limit(60);

  if (dueError) return json({ ok: false, error: "WALLET_OUTBOX_READ_FAILED" }, 500);

  const rows = (dueRows ?? []) as OutboxRow[];
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  let delivered = 0;
  let retried = 0;
  let failed = 0;
  let expired = 0;
  let skipped = 0;

  for (const userId of userIds) {
    const candidates = rows.filter((row) => row.user_id === userId);
    const expiredIds = candidates
      .filter((row) => row.expires_at && new Date(row.expires_at).getTime() <= now.getTime())
      .map((row) => row.id);

    if (expiredIds.length > 0) {
      await db.from("customer_wallet_sync_outbox")
        .update({ status: "expired", last_error_code: "EVENT_EXPIRED", updated_at: new Date().toISOString() })
        .in("id", expiredIds)
        .eq("status", "pending");
      expired += expiredIds.length;
    }

    const live = candidates.filter((row) => !expiredIds.includes(row.id));
    if (live.length === 0) continue;

    const nextAttempt = Math.max(...live.map((row) => Number(row.attempts ?? 0))) + 1;
    const ids = live.map((row) => row.id);
    const { data: claimed, error: claimError } = await db
      .from("customer_wallet_sync_outbox")
      .update({ status: "processing", attempts: nextAttempt, last_error_code: null, updated_at: new Date().toISOString() })
      .in("id", ids)
      .eq("status", "pending")
      .select("id");

    if (claimError || !claimed?.length) continue;
    const claimedIds = claimed.map((row) => String(row.id));

    try {
      const [{ data: wallet, error: walletError }, { data: presentation, error: presentationError }] = await Promise.all([
        db.from("customer_wallet_passes")
          .select("id,provider_instance_id,pass_revision")
          .eq("user_id", userId)
          .eq("status", "active")
          .eq("provider", "pass_studio")
          .not("provider_instance_id", "is", null)
          .is("revoked_at", null)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db.rpc("customer_wallet_presentation_state", { p_user_id: userId }),
      ]);

      if (walletError || presentationError) throw new Error("WALLET_SOURCE_STATE_UNAVAILABLE");
      if (!wallet?.provider_instance_id) {
        await db.from("customer_wallet_sync_outbox")
          .update({ status: "expired", last_error_code: "WALLET_INSTANCE_NOT_AVAILABLE", updated_at: new Date().toISOString() })
          .in("id", claimedIds);
        expired += claimedIds.length;
        continue;
      }

      const rawFields = presentation && typeof presentation === "object" ? (presentation as Record<string, unknown>).fields : null;
      const fields = rawFields && typeof rawFields === "object" ? rawFields as Record<string, string | number | boolean | null> : {};
      if (!Object.prototype.hasOwnProperty.call(fields, "points") || !Object.prototype.hasOwnProperty.call(fields, "tier")) {
        throw new Error("WALLET_PRESENTATION_INVALID");
      }

      await updatePassStudioInstance(apiKey, providerPass, String(wallet.provider_instance_id), fields);

      const syncedAt = new Date().toISOString();
      await db.from("customer_wallet_passes").update({
        provider_status: "issued",
        provider_last_error_code: null,
        last_synced_at: syncedAt,
        pass_revision: Number(wallet.pass_revision ?? 0) + 1,
        updated_at: syncedAt,
      }).eq("id", String(wallet.id));

      await db.from("customer_wallet_sync_outbox").update({
        status: "delivered",
        delivered_at: syncedAt,
        last_error_code: null,
        updated_at: syncedAt,
      }).in("id", claimedIds);
      delivered += claimedIds.length;
    } catch (error) {
      const failure = providerError(error);
      const isProviderFailure = error instanceof PassStudioError;
      const retryable = nextAttempt < 5;

      if (retryable) {
        const delaySeconds = Math.min(300, 15 * (2 ** (nextAttempt - 1)));
        const retryAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
        await db.from("customer_wallet_sync_outbox").update({
          status: "pending",
          next_attempt_at: retryAt,
          last_error_code: isProviderFailure ? failure.code : (error instanceof Error ? error.message.slice(0, 96) : "WALLET_SYNC_FAILED"),
          updated_at: new Date().toISOString(),
        }).in("id", claimedIds);
        await db.from("customer_wallet_passes").update({
          provider_status: "update_pending",
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId).eq("provider", "pass_studio").eq("status", "active");
        retried += claimedIds.length;
      } else {
        const code = isProviderFailure ? failure.code : (error instanceof Error ? error.message.slice(0, 96) : "WALLET_SYNC_FAILED");
        await db.from("customer_wallet_sync_outbox").update({
          status: "failed",
          last_error_code: code,
          updated_at: new Date().toISOString(),
        }).in("id", claimedIds);
        await db.from("customer_wallet_passes").update({
          provider_status: "error",
          provider_last_error_code: code,
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId).eq("provider", "pass_studio").eq("status", "active");
        failed += claimedIds.length;
      }
      console.error("wallet realtime sync failed", { code: isProviderFailure ? failure.code : "LOCAL_SYNC_ERROR", attempt: nextAttempt });
    }
  }

  skipped = Math.max(0, rows.length - delivered - retried - failed - expired);
  return json({ ok: true, processed: rows.length, users: userIds.length, delivered, retried, failed, expired, skipped });
});
