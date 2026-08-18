import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, verifyKioskDevice } from "../_shared/db.ts";

const BUCKET = "advertising-media";
const IMPRESSION_THRESHOLD_MS = 1_000;
const PLAYBACK_STATUSES = new Set(["completed", "failed", "interrupted"]);
const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify({ ...body, correlationId }), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId },
  });
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(stationId)) return reply({ ok: false, error: "INVALID_STATION" }, 400);

    const action = typeof body.action === "string" ? body.action : "playlist";
    if (action !== "playlist" && action !== "impression") {
      return reply({ ok: false, error: "UNKNOWN_ACTION" }, 400);
    }

    const db = adminClient();

    // Paid advertising availability is deliberately independent from the rental
    // credential. A known station may read only its already-active/scheduled,
    // station-targeted public media projection even when rental auth is missing.
    // Mutating/billing-grade impression telemetry remains station-authenticated.
    if (action === "impression") {
      const kiosk = await verifyKioskDevice(req, db, stationId);
      if (!kiosk.ok) return reply({ ok: false, error: kiosk.error }, kiosk.status);

      const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
      const assetId = typeof body.assetId === "string" ? body.assetId : "";
      const displayMode = body.displayMode === "screensaver" ? "screensaver" : body.displayMode === "split" ? "split" : "";
      const durationMs = Math.min(24 * 3600_000, Math.max(0, Math.round(Number(body.durationMs ?? 0))));
      const explicitPlaybackStatus = typeof body.playbackStatus === "string" && PLAYBACK_STATUSES.has(body.playbackStatus)
        ? body.playbackStatus
        : null;
      const playbackStatus = explicitPlaybackStatus ?? "interrupted";
      const started = body.started === true || (body.started === undefined && durationMs >= IMPRESSION_THRESHOLD_MS);
      const completed = playbackStatus === "completed";
      if (!campaignId || !assetId || !displayMode) {
        return reply({ ok: false, error: "INVALID_IMPRESSION" }, 400);
      }

      const { data: item, error: itemError } = await db.from("advertising_campaign_items")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("asset_id", assetId)
        .eq("enabled", true)
        .maybeSingle();
      if (itemError) throw itemError;
      if (!item) return reply({ ok: false, error: "CAMPAIGN_ASSET_MISMATCH" }, 409);

      // Some industrial Android WebViews can display a cached/decode-complete
      // image without emitting React's img onLoad event. The rotation timer still
      // produces a trustworthy `completed` signal for the current media. Treat a
      // completed playback as proof that the media was shown, while assigning
      // only the minimum auditable duration when the start event was missed.
      // Failed/interrupted media never gain this fallback.
      const inferredStartFromCompletion = completed && !started;
      const effectiveStarted = started || inferredStartFromCompletion;
      const effectiveDurationMs = inferredStartFromCompletion
        ? Math.max(IMPRESSION_THRESHOLD_MS, durationMs)
        : durationMs;

      if (!effectiveStarted || effectiveDurationMs < IMPRESSION_THRESHOLD_MS) {
        return reply({
          ok: true,
          recorded: false,
          reason: !effectiveStarted ? "MEDIA_NOT_STARTED" : "BELOW_IMPRESSION_THRESHOLD",
          thresholdMs: IMPRESSION_THRESHOLD_MS,
        });
      }

      const startedAt = new Date(Date.now() - effectiveDurationMs).toISOString();
      const { error } = await db.from("advertising_impressions").insert({
        campaign_id: campaignId,
        asset_id: assetId,
        station_id: stationId,
        kiosk_device_id: kiosk.device.id,
        display_mode: displayMode,
        started_at: startedAt,
        completed_at: completed ? new Date().toISOString() : null,
        duration_ms: effectiveDurationMs,
        completed,
      });
      if (error) throw error;
      return reply({
        ok: true,
        recorded: true,
        thresholdMs: IMPRESSION_THRESHOLD_MS,
        inferredStartFromCompletion,
      });
    }

    const { data: station, error: stationError } = await db.from("stations")
      .select("station_id")
      .eq("station_id", stationId)
      .maybeSingle();
    if (stationError) throw stationError;
    if (!station) return reply({ ok: false, error: "STATION_NOT_FOUND" }, 404);

    const nowMs = Date.now();
    const { data: campaigns, error: campaignError } = await db.from("advertising_campaigns")
      .select("id,name,status,display_modes,all_stations,starts_at,ends_at,idle_after_seconds,split_ratio,priority,qr_url,updated_at")
      .in("status", ["active", "scheduled"])
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(100);
    if (campaignError) throw campaignError;

    const candidates = (campaigns ?? []).filter((campaign) => {
      const starts = campaign.starts_at ? Date.parse(campaign.starts_at) : null;
      const ends = campaign.ends_at ? Date.parse(campaign.ends_at) : null;
      if (starts !== null && Number.isFinite(starts) && starts > nowMs) return false;
      if (ends !== null && Number.isFinite(ends) && ends <= nowMs) return false;
      return true;
    });
    if (!candidates.length) {
      return reply({ ok: true, stationId, version: "empty", serverTimeMs: Date.now(), timelineEpochMs: 0, campaigns: [] });
    }

    const campaignIds = candidates.map((campaign) => campaign.id);
    const [targetResult, itemResult] = await Promise.all([
      db.from("advertising_campaign_stations").select("campaign_id,station_id").in("campaign_id", campaignIds),
      db.from("advertising_campaign_items")
        .select("id,campaign_id,asset_id,sort_order,image_duration_seconds,enabled,qr_destination_url,cta_label,transition_style,asset:advertising_assets(id,title,storage_path,media_type,mime_type,width,height,duration_seconds,poster_storage_path,active,updated_at)")
        .in("campaign_id", campaignIds)
        .eq("enabled", true)
        .order("sort_order", { ascending: true }),
    ]);
    if (targetResult.error || itemResult.error) throw targetResult.error ?? itemResult.error;

    const targets = new Map<string, Set<string>>();
    for (const target of targetResult.data ?? []) {
      if (!targets.has(target.campaign_id)) targets.set(target.campaign_id, new Set());
      targets.get(target.campaign_id)?.add(target.station_id);
    }

    const itemsByCampaign = new Map<string, Array<Record<string, unknown>>>();
    for (const row of itemResult.data ?? []) {
      const asset = Array.isArray(row.asset) ? row.asset[0] : row.asset;
      if (!asset || !asset.active) continue;
      const publicUrl = db.storage.from(BUCKET).getPublicUrl(asset.storage_path).data.publicUrl;
      const posterUrl = asset.poster_storage_path ? db.storage.from(BUCKET).getPublicUrl(asset.poster_storage_path).data.publicUrl : null;
      const item = {
        id: row.id,
        assetId: asset.id,
        title: asset.title,
        mediaType: asset.media_type,
        mimeType: asset.mime_type,
        url: publicUrl,
        posterUrl,
        width: asset.width ?? null,
        height: asset.height ?? null,
        imageDurationSeconds: row.image_duration_seconds ?? 8,
        mediaDurationSeconds: asset.duration_seconds ?? null,
        sortOrder: row.sort_order,
        qrDestinationUrl: row.qr_destination_url ?? null,
        ctaLabel: row.cta_label ?? null,
        transitionStyle: row.transition_style ?? "crossfade",
      };
      if (!itemsByCampaign.has(row.campaign_id)) itemsByCampaign.set(row.campaign_id, []);
      itemsByCampaign.get(row.campaign_id)?.push(item);
    }

    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
    const targetedCampaigns = candidates.filter((campaign) => campaign.all_stations || targets.get(campaign.id)?.has(stationId));

    // The current kiosk player consumes one campaign-level qrUrl per entry. To
    // preserve its proven synchronized playback while restoring the canonical
    // per-media QR contract, project each active media item as a one-item campaign
    // slice. The media item retains its canonical destination/CTA data; qrUrl is
    // a station-bound tracking URL that records the scan and then redirects.
    const payload = targetedCampaigns.flatMap((campaign) => {
      const items = itemsByCampaign.get(campaign.id) ?? [];
      return items.map((item) => {
        const destination = typeof item.qrDestinationUrl === "string" ? item.qrDestinationUrl.trim() : "";
        const trackedQrUrl = destination && supabaseUrl
          ? `${supabaseUrl}/functions/v1/ads-qr-redirect?c=${encodeURIComponent(campaign.id)}&a=${encodeURIComponent(String(item.assetId))}&s=${encodeURIComponent(stationId)}`
          : (campaign.qr_url ?? null);
        return {
          id: campaign.id,
          name: campaign.name,
          modes: campaign.display_modes,
          idleAfterSeconds: campaign.idle_after_seconds,
          splitRatio: Number(campaign.split_ratio),
          priority: campaign.priority,
          qrUrl: trackedQrUrl,
          updatedAt: campaign.updated_at,
          items: [item],
        };
      });
    });

    const versionSeed = payload
      .map((campaign) => `${campaign.id}:${campaign.updatedAt}:${campaign.qrUrl ?? ""}:${campaign.items.map((item) => `${item.assetId}:${item.sortOrder}:${item.imageDurationSeconds}:${item.qrDestinationUrl ?? ""}:${item.ctaLabel ?? ""}:${item.transitionStyle ?? ""}`).join(",")}`)
      .join("|");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(versionSeed || "empty"));
    const version = Array.from(new Uint8Array(digest))
      .slice(0, 8)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    // Kiosks use this server clock only to choose the same deterministic media
    // position. It does not grant any authority over rental/payment state.
    return reply({ ok: true, stationId, version, serverTimeMs: Date.now(), timelineEpochMs: 0, campaigns: payload });
  } catch (error) {
    console.error("kiosk-ads-playlist", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "ADS_PLAYLIST_FAILED" }, 500);
  }
});
