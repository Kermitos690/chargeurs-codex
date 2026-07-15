import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, getCaller, sha256Hex } from "../_shared/db.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^wq_[A-Za-z0-9_-]{30,80}$/.test(token)) return json({ state: "neutral" });

  const tokenHash = await sha256Hex(token);
  const rate = await db.rpc("claim_wallet_rate_limit", {
    p_rate_key: `wallet-link:${tokenHash.slice(0, 32)}`,
    p_limit: 30,
    p_window_seconds: 60,
  });
  if (rate.error || rate.data !== true) return json({ state: "neutral" }, 429);

  const passResult = await db.from("wallet_passes").select("id,user_id,status")
    .eq("qr_token_hash", tokenHash).maybeSingle();
  if (passResult.error || !passResult.data || passResult.data.status !== "active") return json({ state: "neutral" });

  const caller = await getCaller(req, db);
  if (!caller.userId) return json({ state: "authentication_required", redirectTo: `/wallet/${encodeURIComponent(token)}` });
  if (caller.userId !== passResult.data.user_id) return json({ state: "neutral" });

  return json({ state: "owner", destination: "/compte", walletPassId: passResult.data.id });
});
