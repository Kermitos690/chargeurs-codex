import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, getCaller, auditLog } from "../_shared/db.ts";

const BUCKET = "advertising-media";
const READ_ROLES = ["super_admin", "admin", "operations_admin", "advertising_manager", "viewer"] as const;
const WRITE_ROLES = ["super_admin", "admin", "operations_admin", "advertising_manager"] as const;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"]);
const MAX_BYTES = 100 * 1024 * 1024;
const STATUSES = new Set(["draft", "scheduled", "active", "paused", "archived"]);
const MODES = new Set(["split", "screensaver"]);

function safeText(value: unknown, max = 160): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function safeNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function safeModes(value: unknown): string[] {
  if (!Array.isArray(value)) return ["split", "screensaver"];
  const modes = [...new Set(value.filter((item): item is string => typeof item === "string" && MODES.has(item)))];
  return modes.length ? modes : ["split", "screensaver"];
}
function safeIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function safeFilename(name: string): string {
  const cleaned = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return (cleaned || "media").slice(-120);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const { userId, roles } = await getCaller(req, db);
  if (!userId || !roles.some((role) => READ_ROLES.includes(role as typeof READ_ROLES[number]))) {
    return json({ ok: false, error: "FORBIDDEN" }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = safeText(body.action, 64);

    if (action === "list") {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [campaignsResult, assetsResult, itemsResult, targetsResult, stationsResult, impressionsResult] = await Promise.all([
        db.from("advertising_campaigns").select("*").order("created_at", { ascending: false }),
        db.from("advertising_assets").select("*").order("created_at", { ascending: false }),
        db.from("advertising_campaign_items").select("*").order("sort_order", { ascending: true }),
        db.from("advertising_campaign_stations").select("campaign_id,station_id"),
        db.from("stations").select("station_id,name,location_name,status,online").order("name", { ascending: true }),
        db.from("advertising_impressions").select("campaign_id,asset_id,station_id,display_mode,started_at,duration_ms,completed").gte("started_at", since).order("started_at", { ascending: false }).limit(5000),
      ]);
      const error = campaignsResult.error ?? assetsResult.error ?? itemsResult.error ?? targetsResult.error ?? stationsResult.error ?? impressionsResult.error;
      if (error) throw error;
      return json({ ok: true, campaigns: campaignsResult.data ?? [], assets: assetsResult.data ?? [], items: itemsResult.data ?? [], targets: targetsResult.data ?? [], stations: stationsResult.data ?? [], impressions: impressionsResult.data ?? [] });
    }

    if (!roles.some((role) => WRITE_ROLES.includes(role as typeof WRITE_ROLES[number]))) {
      return json({ ok: false, error: "FORBIDDEN_WRITE" }, 403);
    }

    if (action === "prepare_upload") {
      const filename = safeFilename(safeText(body.filename, 180));
      const mimeType = safeText(body.mimeType, 100).toLowerCase();
      const size = Math.max(0, Math.floor(safeNumber(body.size, 0)));
      if (!filename || !MIME_TYPES.has(mimeType)) return json({ ok: false, error: "UNSUPPORTED_MEDIA_TYPE" }, 400);
      if (!size || size > MAX_BYTES) return json({ ok: false, error: "INVALID_FILE_SIZE", maxBytes: MAX_BYTES }, 400);
      const now = new Date();
      const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const path = `${folder}/${crypto.randomUUID()}-${filename}`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data?.token) throw error ?? new Error("SIGNED_UPLOAD_FAILED");
      return json({ ok: true, bucket: BUCKET, path, token: data.token });
    }

    if (action === "register_asset") {
      const path = safeText(body.path, 500);
      const title = safeText(body.title, 160);
      const mimeType = safeText(body.mimeType, 100).toLowerCase();
      const mediaType = mimeType.startsWith("video/") ? "video" : mimeType.startsWith("image/") ? "image" : "";
      const size = Math.max(0, Math.floor(safeNumber(body.size, 0)));
      if (!path || !title || !mediaType || !MIME_TYPES.has(mimeType) || !size || size > MAX_BYTES) return json({ ok: false, error: "INVALID_ASSET" }, 400);
      const { data, error } = await db.from("advertising_assets").insert({
        title, storage_path: path, media_type: mediaType, mime_type: mimeType, file_size_bytes: size,
        width: Number.isFinite(Number(body.width)) && Number(body.width) > 0 ? Math.round(Number(body.width)) : null,
        height: Number.isFinite(Number(body.height)) && Number(body.height) > 0 ? Math.round(Number(body.height)) : null,
        duration_seconds: Number.isFinite(Number(body.durationSeconds)) && Number(body.durationSeconds) > 0 ? Number(body.durationSeconds) : null,
        created_by: userId,
      }).select("*").single();
      if (error) throw error;
      await auditLog(db, { actor: userId, action: "advertising.asset.created", target: data.id, data: { media_type: mediaType, path } });
      return json({ ok: true, asset: data });
    }

    if (action === "delete_asset") {
      const assetId = safeText(body.assetId, 64);
      const { data: asset } = await db.from("advertising_assets").select("id,storage_path").eq("id", assetId).maybeSingle();
      if (!asset) return json({ ok: false, error: "ASSET_NOT_FOUND" }, 404);
      const { count } = await db.from("advertising_campaign_items").select("id", { count: "exact", head: true }).eq("asset_id", assetId);
      if ((count ?? 0) > 0) return json({ ok: false, error: "ASSET_IN_USE" }, 409);
      const { error: storageError } = await db.storage.from(BUCKET).remove([asset.storage_path]);
      if (storageError) throw storageError;
      const { error } = await db.from("advertising_assets").delete().eq("id", assetId);
      if (error) throw error;
      await auditLog(db, { actor: userId, action: "advertising.asset.deleted", target: assetId });
      return json({ ok: true });
    }

    if (action === "create_campaign") {
      const name = safeText(body.name, 120);
      if (!name) return json({ ok: false, error: "MISSING_NAME" }, 400);
      const startsAt = safeIso(body.startsAt);
      const endsAt = safeIso(body.endsAt);
      if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return json({ ok: false, error: "INVALID_DATE_RANGE" }, 400);
      const { data, error } = await db.from("advertising_campaigns").insert({
        name, status: "draft", display_modes: safeModes(body.displayModes), all_stations: body.allStations !== false,
        starts_at: startsAt, ends_at: endsAt,
        idle_after_seconds: Math.min(900, Math.max(10, Math.round(safeNumber(body.idleAfterSeconds, 45)))),
        split_ratio: Math.min(0.5, Math.max(0.2, safeNumber(body.splitRatio, 0.35))),
        priority: Math.min(10000, Math.max(0, Math.round(safeNumber(body.priority, 100)))), created_by: userId,
      }).select("*").single();
      if (error) throw error;
      await auditLog(db, { actor: userId, action: "advertising.campaign.created", target: data.id, data: { name } });
      return json({ ok: true, campaign: data });
    }

    if (action === "update_campaign") {
      const campaignId = safeText(body.campaignId, 64);
      if (!campaignId) return json({ ok: false, error: "MISSING_CAMPAIGN" }, 400);
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.name !== undefined) { const name = safeText(body.name, 120); if (!name) return json({ ok: false, error: "MISSING_NAME" }, 400); update.name = name; }
      if (body.status !== undefined) { const status = safeText(body.status, 32); if (!STATUSES.has(status)) return json({ ok: false, error: "INVALID_STATUS" }, 400); update.status = status; }
      if (body.displayModes !== undefined) update.display_modes = safeModes(body.displayModes);
      if (body.allStations !== undefined) update.all_stations = Boolean(body.allStations);
      if (body.startsAt !== undefined) update.starts_at = safeIso(body.startsAt);
      if (body.endsAt !== undefined) update.ends_at = safeIso(body.endsAt);
      if (body.idleAfterSeconds !== undefined) update.idle_after_seconds = Math.min(900, Math.max(10, Math.round(safeNumber(body.idleAfterSeconds, 45))));
      if (body.splitRatio !== undefined) update.split_ratio = Math.min(0.5, Math.max(0.2, safeNumber(body.splitRatio, 0.35)));
      if (body.priority !== undefined) update.priority = Math.min(10000, Math.max(0, Math.round(safeNumber(body.priority, 100))));
      const startsAt = update.starts_at === undefined ? undefined : update.starts_at as string | null;
      const endsAt = update.ends_at === undefined ? undefined : update.ends_at as string | null;
      if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return json({ ok: false, error: "INVALID_DATE_RANGE" }, 400);
      const { data, error } = await db.from("advertising_campaigns").update(update).eq("id", campaignId).select("*").maybeSingle();
      if (error) throw error;
      if (!data) return json({ ok: false, error: "CAMPAIGN_NOT_FOUND" }, 404);
      await auditLog(db, { actor: userId, action: "advertising.campaign.updated", target: campaignId });
      return json({ ok: true, campaign: data });
    }

    if (action === "set_campaign_items") {
      const campaignId = safeText(body.campaignId, 64);
      const rawItems = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
      const items = rawItems.map((item: Record<string, unknown>, index: number) => ({
        campaign_id: campaignId, asset_id: safeText(item.assetId, 64), sort_order: index,
        image_duration_seconds: item.imageDurationSeconds == null ? null : Math.min(300, Math.max(2, Math.round(safeNumber(item.imageDurationSeconds, 8)))),
        enabled: item.enabled !== false, updated_at: new Date().toISOString(),
      })).filter((item: { asset_id: string }) => Boolean(item.asset_id));
      if (!campaignId) return json({ ok: false, error: "MISSING_CAMPAIGN" }, 400);
      const assetIds = [...new Set(items.map((item: { asset_id: string }) => item.asset_id))];
      if (assetIds.length) {
        const { data: assets, error: assetsError } = await db.from("advertising_assets").select("id").in("id", assetIds).eq("active", true);
        if (assetsError) throw assetsError;
        if ((assets ?? []).length !== assetIds.length) return json({ ok: false, error: "UNKNOWN_ASSET" }, 400);
      }
      const { error: deleteError } = await db.from("advertising_campaign_items").delete().eq("campaign_id", campaignId);
      if (deleteError) throw deleteError;
      if (items.length) { const { error: insertError } = await db.from("advertising_campaign_items").insert(items); if (insertError) throw insertError; }
      await db.from("advertising_campaigns").update({ updated_at: new Date().toISOString() }).eq("id", campaignId);
      await auditLog(db, { actor: userId, action: "advertising.campaign.playlist.updated", target: campaignId, data: { items: items.length } });
      return json({ ok: true });
    }

    if (action === "set_campaign_stations") {
      const campaignId = safeText(body.campaignId, 64);
      const stationIds = [...new Set((Array.isArray(body.stationIds) ? body.stationIds : []).map((value: unknown) => safeText(value, 32)).filter(Boolean))].slice(0, 500);
      if (!campaignId) return json({ ok: false, error: "MISSING_CAMPAIGN" }, 400);
      if (stationIds.length) {
        const { data: stations, error: stationError } = await db.from("stations").select("station_id").in("station_id", stationIds);
        if (stationError) throw stationError;
        if ((stations ?? []).length !== stationIds.length) return json({ ok: false, error: "UNKNOWN_STATION" }, 400);
      }
      const { error: deleteError } = await db.from("advertising_campaign_stations").delete().eq("campaign_id", campaignId);
      if (deleteError) throw deleteError;
      if (stationIds.length) { const { error: insertError } = await db.from("advertising_campaign_stations").insert(stationIds.map((stationId) => ({ campaign_id: campaignId, station_id: stationId }))); if (insertError) throw insertError; }
      const allStations = body.allStations !== undefined ? Boolean(body.allStations) : stationIds.length === 0;
      const { error: campaignError } = await db.from("advertising_campaigns").update({ all_stations: allStations, updated_at: new Date().toISOString() }).eq("id", campaignId);
      if (campaignError) throw campaignError;
      await auditLog(db, { actor: userId, action: "advertising.campaign.targets.updated", target: campaignId, data: { all_stations: allStations, stations: stationIds } });
      return json({ ok: true });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("ads-admin", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return json({ ok: false, error: "ADS_ADMIN_INTERNAL_ERROR" }, 500);
  }
});
