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
  if (!/^wq_[A-Za-z0-9_-]{30,}$/.test(token)) return json({ state: "neutral" });

  const tokenHash = await sha256Hex(token);
  const passResult = await db.from("wallet_passes").select("id,user_id,status")
    .eq("qr_token_hash", tokenHash).maybeSingle();
  if (passResult.error || !passResult.data || passResult.data.status !== "active") return json({ state: "neutral" });

  const caller = await getCaller(req, db);
  if (!caller.userId) return json({ state: "authentication_required", redirectTo: `/wallet/${encodeURIComponent(token)}` });
  if (caller.userId !== passResult.data.user_id) return json({ state: "neutral" });

  return json({ state: "owner", destination: "/compte", walletPassId: passResult.data.id });
});
