import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const headers = {
  ...corsHeaders,
  "Content-Type": "application/json",
  "Cache-Control": "no-store, max-age=0",
};

Deno.serve(async (req) => {
  const serverReceiveMs = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), { status: 405, headers });
  }

  // Deliberately public and data-free: this endpoint exposes only authoritative
  // wall-clock timestamps for Ads playback synchronization. It has no station,
  // rental, payment, inventory, user, campaign or credential access.
  const serverSendMs = Date.now();
  return new Response(JSON.stringify({
    ok: true,
    serverReceiveMs,
    serverSendMs,
    timelineEpochMs: 0,
  }), { headers });
});
