// admin-overview-read — read-only operational Control Center projection.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireRoles } from "../_shared/db.ts";

const READ_ROLES = [
  "super_admin", "admin", "operations_admin", "finance_admin", "support_agent",
  "maintenance_technician", "staff", "operator", "viewer",
] as const;
const KIOSK_STALE_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function dayKey(value: string | number | Date): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function number(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type Alert = {
  id: string;
  severity: keyof typeof SEVERITY_RANK;
  stationId: string;
  title: string;
  detail: string;
  recommendation: string;
  href: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const db = adminClient();
  const userId = await requireRoles(req, db, READ_ROLES);
  if (!userId) return json({ ok: false, error: "FORBIDDEN" }, 403);

  const now = Date.now();
  const since7d = new Date(now - 6 * DAY_MS).toISOString().slice(0, 10) + "T00:00:00.000Z";
  const since30d = new Date(now - 30 * DAY_MS).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const [stationsResult, kioskResult, paymentsResult, rentalsResult, impressionsResult] = await Promise.all([
    db.from("stations").select("station_id,name,location_name,status,online,rentable_count,returnable_count,total_count,last_sync_at,provider_last_success_at,provider_last_error_at,provider_last_error,environment,is_pilot"),
    db.from("kiosk_devices").select("id,station_id,active,token_revoked,token_expires_at,last_seen_at,created_at,updated_at"),
    db.from("payments").select("id,status,amount,currency,amount_captured_cents,amount_refunded_cents,created_at").gte("created_at", since7d),
    db.from("rental_sessions").select("id,station_id,state,created_at,completed_at,final_amount_cents,captured_amount_cents,refunded_amount_cents").gte("created_at", since7d),
    db.from("advertising_impressions").select("station_id,started_at,duration_ms,completed").gte("started_at", since30d),
  ]);

  for (const result of [stationsResult, kioskResult, paymentsResult, rentalsResult, impressionsResult]) {
    if (result.error) {
      console.error("admin-overview-read", result.error.message);
      return json({ ok: false, error: "OVERVIEW_READ_FAILED" }, 500);
    }
  }

  const allStations = stationsResult.data ?? [];
  const stations = allStations.filter((row: any) => !String(row.station_id ?? "").startsWith("DEMO-"));
  const kioskRows = kioskResult.data ?? [];
  const payments = paymentsResult.data ?? [];
  const rentals = rentalsResult.data ?? [];
  const impressions = impressionsResult.data ?? [];

  const activeDeviceByStation = new Map<string, any>();
  for (const device of kioskRows) {
    if (!device.active || device.token_revoked) continue;
    if (device.token_expires_at && Date.parse(device.token_expires_at) <= now) continue;
    const existing = activeDeviceByStation.get(device.station_id);
    const currentSeen = device.last_seen_at ? Date.parse(device.last_seen_at) : 0;
    const existingSeen = existing?.last_seen_at ? Date.parse(existing.last_seen_at) : 0;
    if (!existing || currentSeen >= existingSeen) activeDeviceByStation.set(device.station_id, device);
  }

  const alerts: Alert[] = [];
  const fleet = stations.map((station: any) => {
    const device = activeDeviceByStation.get(station.station_id);
    const lastSeenMs = device?.last_seen_at ? Date.parse(device.last_seen_at) : 0;
    const kioskFresh = Boolean(device && lastSeenMs > 0 && now - lastSeenMs <= KIOSK_STALE_MS);
    const providerOnline = station.online === true;
    const rentable = number(station.rentable_count);
    const rentalReady = providerOnline && kioskFresh && rentable > 0;

    if (!providerOnline) {
      alerts.push({
        id: `${station.station_id}:offline`, severity: "critical", stationId: station.station_id,
        title: `${station.station_id} — borne hors ligne`,
        detail: `La borne ne remonte plus comme disponible côté fournisseur${station.provider_last_error ? ` (${station.provider_last_error})` : ""}.`,
        recommendation: "Vérifier l’alimentation, le réseau local et la dernière synchronisation fournisseur avant tout test de location.",
        href: `/admin/stations/${encodeURIComponent(station.station_id)}`,
      });
    } else if (!kioskFresh) {
      alerts.push({
        id: `${station.station_id}:kiosk-auth`, severity: "critical", stationId: station.station_id,
        title: `${station.station_id} — location Chargeurs indisponible`,
        detail: `Le matériel est en ligne et annonce ${rentable}/${number(station.total_count)} batterie(s) rentable(s), mais aucun kiosk Chargeurs authentifié et récent n’est actif.`,
        recommendation: "Réauthentifier/réenrôler le kiosk. Ne pas toucher au fournisseur : la borne matérielle est joignable.",
        href: "/admin/kiosk-devices",
      });
    } else if (rentable <= 0) {
      alerts.push({
        id: `${station.station_id}:stock`, severity: "warning", stationId: station.station_id,
        title: `${station.station_id} — aucune batterie rentable`,
        detail: `Le kiosk et la borne répondent, mais le stock rentable est à 0/${number(station.total_count)}.`,
        recommendation: "Contrôler l’état des slots, la qualification des batteries et les retours avant de déplacer du matériel.",
        href: `/admin/stations/${encodeURIComponent(station.station_id)}`,
      });
    }

    if (providerOnline && station.provider_last_error_at && (!station.provider_last_success_at || Date.parse(station.provider_last_error_at) > Date.parse(station.provider_last_success_at))) {
      alerts.push({
        id: `${station.station_id}:provider-error`, severity: "warning", stationId: station.station_id,
        title: `${station.station_id} — erreur fournisseur récente`,
        detail: String(station.provider_last_error ?? "Une erreur fournisseur a été enregistrée."),
        recommendation: "Comparer le dernier succès fournisseur avec l’erreur avant d’intervenir physiquement.",
        href: `/admin/stations/${encodeURIComponent(station.station_id)}`,
      });
    }

    return {
      stationId: station.station_id,
      name: station.name,
      locationName: station.location_name,
      providerOnline,
      kioskAuthenticated: kioskFresh,
      rentalReady,
      status: station.status,
      rentableCount: rentable,
      returnableCount: number(station.returnable_count),
      totalCount: number(station.total_count),
      lastSyncAt: station.last_sync_at,
      lastProviderSuccessAt: station.provider_last_success_at,
      lastKioskSeenAt: device?.last_seen_at ?? null,
      providerError: station.provider_last_error ?? null,
    };
  });

  const days = Array.from({ length: 7 }, (_, index) => {
    const timestamp = now - (6 - index) * DAY_MS;
    const date = dayKey(timestamp);
    return { date, rentals: 0, completedRentals: 0, payments: 0, revenueCents: 0, adMinutes: 0 };
  });
  const byDay = new Map(days.map((row) => [row.date, row]));

  for (const rental of rentals) {
    const row = byDay.get(dayKey(rental.created_at));
    if (!row) continue;
    row.rentals += 1;
    if (["completed", "returned", "battery_returned"].includes(String(rental.state))) row.completedRentals += 1;
  }
  for (const payment of payments) {
    const row = byDay.get(dayKey(payment.created_at));
    if (!row) continue;
    if (!["failed", "canceled", "cancelled"].includes(String(payment.status ?? "").toLowerCase())) row.payments += 1;
    const captured = number(payment.amount_captured_cents);
    const refunded = number(payment.amount_refunded_cents);
    row.revenueCents += Math.max(0, captured - refunded);
  }
  for (const impression of impressions) {
    const row = byDay.get(dayKey(impression.started_at));
    if (!row) continue;
    row.adMinutes += number(impression.duration_ms) / 60_000;
  }

  const todayPayments = payments.filter((row: any) => dayKey(row.created_at) === today);
  const todayRentals = rentals.filter((row: any) => dayKey(row.created_at) === today);
  const revenueTodayCents = todayPayments.reduce((sum: number, row: any) => sum + Math.max(0, number(row.amount_captured_cents) - number(row.amount_refunded_cents)), 0);
  const adDurationMs30d = impressions.reduce((sum: number, row: any) => sum + number(row.duration_ms), 0);
  const rentalReadyCount = fleet.filter((row) => row.rentalReady).length;
  const providerOnlineCount = fleet.filter((row) => row.providerOnline).length;
  const kioskAuthenticatedCount = fleet.filter((row) => row.kioskAuthenticated).length;
  const criticalCount = alerts.filter((row) => row.severity === "critical").length;
  const healthScore = fleet.length ? Math.round((rentalReadyCount / fleet.length) * 100) : 100;

  alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return json({
    ok: true,
    generatedAt: new Date(now).toISOString(),
    metrics: {
      stations: fleet.length,
      providerOnline: providerOnlineCount,
      kioskAuthenticated: kioskAuthenticatedCount,
      rentalReady: rentalReadyCount,
      healthScore,
      batteries: fleet.reduce((sum, row) => sum + row.rentableCount, 0),
      activeRentals: rentals.filter((row: any) => ["active_rental", "active", "battery_taken", "ejected"].includes(String(row.state))).length,
      rentalsToday: todayRentals.length,
      paymentsToday: todayPayments.length,
      revenueTodayCents,
      criticalAlerts: criticalCount,
      adImpressions30d: impressions.length,
      adHours30d: adDurationMs30d / 3_600_000,
    },
    alerts,
    fleet,
    trends: days.map((row) => ({ ...row, adMinutes: Math.round(row.adMinutes * 10) / 10 })),
  });
});
