import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, sha256Hex } from "../_shared/db.ts";
import { notifyPassDevices } from "../_shared/applePush.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function authorized(req: Request): Promise<boolean> {
  const expected = Deno.env.get("WALLET_PUSH_JOB_SECRET")?.trim() ?? "";
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !provided) return false;
  return await sha256Hex(expected) === await sha256Hex(provided);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!await authorized(req)) return json({ error: "UNAUTHORIZED" }, 401);

  const db = adminClient();
  const rate = await db.rpc("claim_wallet_rate_limit", {
    p_rate_key: "wallet-push-worker",
    p_limit: 12,
    p_window_seconds: 60,
  });
  if (rate.error || rate.data !== true) return json({ error: "RATE_LIMITED" }, 429);

  const queued = await db.from("wallet_pass_events")
    .select("id,wallet_pass_id")
    .eq("result", "queued")
    .order("created_at", { ascending: true })
    .limit(250);
  if (queued.error) return json({ error: "QUEUE_READ_FAILED" }, 500);

  const eventIdsByPass = new Map<string, string[]>();
  for (const event of queued.data ?? []) {
    const ids = eventIdsByPass.get(event.wallet_pass_id) ?? [];
    ids.push(event.id);
    eventIdsByPass.set(event.wallet_pass_id, ids);
  }

  const passIds = [...eventIdsByPass.keys()];
  if (!passIds.length) return json({ ok: true, passes: 0, events: 0, sent: 0, failed: 0 });
  const passes = await db.from("wallet_passes")
    .select("id,pass_type_identifier,status")
    .in("id", passIds);
  if (passes.error) return json({ error: "PASS_READ_FAILED" }, 500);

  let sent = 0;
  let failed = 0;
  let processedPasses = 0;
  for (const pass of passes.data ?? []) {
    const eventIds = eventIdsByPass.get(pass.id) ?? [];
    if (!eventIds.length) continue;
    try {
      const result = await notifyPassDevices(db, pass.id, pass.pass_type_identifier);
      sent += result.sent;
      failed += result.failed;
      processedPasses += 1;
      await db.from("wallet_pass_events").update({
        result: result.failed > 0 ? "partial" : "success",
        metadata: { devices: result.devices, sent: result.sent, failed: result.failed, pass_status: pass.status },
      }).in("id", eventIds);
    } catch (error) {
      failed += 1;
      await db.from("wallet_pass_events").update({
        result: "failed",
        metadata: { error: error instanceof Error ? error.message.split(":")[0] : "PUSH_FAILED" },
      }).in("id", eventIds);
    }
  }

  await auditLog(db, {
    action: "wallet.push.batch",
    data: { passes: processedPasses, events: queued.data?.length ?? 0, sent, failed },
  });
  return json({ ok: true, passes: processedPasses, events: queued.data?.length ?? 0, sent, failed });
});
