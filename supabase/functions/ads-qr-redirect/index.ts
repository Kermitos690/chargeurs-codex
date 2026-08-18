import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATION_RE = /^[A-Za-z0-9_-]{4,32}$/;

function text(message: string, status = 400) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return text("Method not allowed", 405);

  const url = new URL(req.url);
  const campaignId = (url.searchParams.get("c") ?? "").trim();
  const assetId = (url.searchParams.get("a") ?? "").trim();
  const stationId = (url.searchParams.get("s") ?? "").trim();

  if (!UUID_RE.test(campaignId) || !UUID_RE.test(assetId) || !STATION_RE.test(stationId)) {
    return text("Lien publicitaire invalide", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return text("Service indisponible", 503);

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const now = Date.now();

  const { data: campaign, error: campaignError } = await db
    .from("advertising_campaigns")
    .select("id,status,all_stations,starts_at,ends_at")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError || !campaign) return text("Campagne indisponible", 404);
  if (!["active", "scheduled"].includes(String(campaign.status))) return text("Campagne indisponible", 404);

  const startsAt = campaign.starts_at ? Date.parse(campaign.starts_at) : null;
  const endsAt = campaign.ends_at ? Date.parse(campaign.ends_at) : null;
  if (startsAt !== null && Number.isFinite(startsAt) && startsAt > now) return text("Campagne indisponible", 404);
  if (endsAt !== null && Number.isFinite(endsAt) && endsAt <= now) return text("Campagne indisponible", 404);

  const { data: station } = await db.from("stations").select("station_id").eq("station_id", stationId).maybeSingle();
  if (!station) return text("Borne inconnue", 404);

  if (!campaign.all_stations) {
    const { data: target } = await db
      .from("advertising_campaign_stations")
      .select("station_id")
      .eq("campaign_id", campaignId)
      .eq("station_id", stationId)
      .maybeSingle();
    if (!target) return text("Campagne indisponible", 404);
  }

  const { data: item, error: itemError } = await db
    .from("advertising_campaign_items")
    .select("asset_id,enabled,qr_destination_url")
    .eq("campaign_id", campaignId)
    .eq("asset_id", assetId)
    .eq("enabled", true)
    .maybeSingle();
  if (itemError || !item?.qr_destination_url) return text("Destination indisponible", 404);

  let destination: URL;
  try {
    destination = new URL(String(item.qr_destination_url));
    if (destination.protocol !== "https:") return text("Destination invalide", 400);
  } catch {
    return text("Destination invalide", 400);
  }

  if (req.method === "GET") {
    const { error: insertError } = await db.from("advertising_qr_scans").insert({
      campaign_id: campaignId,
      asset_id: assetId,
      station_id: stationId,
      destination_host: destination.hostname.replace(/^www\./i, "").slice(0, 255),
      source: "kiosk_qr",
    });
    if (insertError) console.error("ads-qr-redirect scan write failed", insertError.message);
  }

  return Response.redirect(destination.toString(), 302);
});
