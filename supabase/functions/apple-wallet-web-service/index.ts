import { adminClient, sha256Hex } from "../_shared/db.ts";
import {
  appleWalletConfigStatus,
  buildSignedPass,
  prepareWalletSnapshot,
  verifyApplePassAuthorization,
  type CustomerWalletPassRow,
} from "../_shared/appleWallet.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function noContent(status = 204) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

function routeParts(url: URL): string[] {
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const functionIndex = parts.indexOf("apple-wallet-web-service");
  return functionIndex >= 0 ? parts.slice(functionIndex + 1) : parts;
}

function passTypeIdentifier(): string {
  return Deno.env.get("APPLE_PASS_TYPE_IDENTIFIER")?.trim() ?? "";
}

function walletUpdateTag(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const value = (metadata as Record<string, unknown>).wallet_update_tag_ms;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

async function findPassBySerial(db: ReturnType<typeof adminClient>, serialNumber: string) {
  const result = await db.from("customer_wallet_passes")
    .select("id,user_id,membership_id,public_pass_id,apple_serial_number,status,token_version,access_token_hash,pass_revision,provider_status,last_generated_at,last_synced_at,revoked_at,provider_metadata,updated_at")
    .eq("apple_serial_number", serialNumber)
    .eq("status", "active")
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as (CustomerWalletPassRow & { updated_at: string }) | null;
}

Deno.serve(async (req) => {
  const config = appleWalletConfigStatus();
  if (!config.ready) return json({ error: "APPLE_WALLET_NOT_CONFIGURED" }, 503);

  const db = adminClient();
  const url = new URL(req.url);
  const parts = routeParts(url);

  // POST /v1/log — Apple diagnostic messages are intentionally not persisted;
  // they can contain device-generated free text. A 200 acknowledges receipt.
  if (req.method === "POST" && parts.length === 2 && parts[0] === "v1" && parts[1] === "log") {
    await req.json().catch(() => ({}));
    return noContent(200);
  }

  // /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}
  const isRegistrationRoute = parts.length === 6 && parts[0] === "v1" && parts[1] === "devices" && parts[3] === "registrations";
  if (isRegistrationRoute && (req.method === "POST" || req.method === "DELETE")) {
    const deviceLibraryIdentifier = parts[2];
    const requestedPassType = parts[4];
    const serialNumber = parts[5];
    if (requestedPassType !== passTypeIdentifier()) return noContent(401);

    const pass = await findPassBySerial(db, serialNumber);
    if (!pass || !(await verifyApplePassAuthorization(pass, req.headers.get("Authorization")))) return noContent(401);
    const deviceHash = await sha256Hex(deviceLibraryIdentifier);

    if (req.method === "DELETE") {
      await db.from("customer_wallet_device_registrations")
        .update({ unregistered_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })
        .eq("wallet_pass_id", pass.id)
        .eq("device_library_identifier_hash", deviceHash);
      return noContent(200);
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const pushToken = typeof body.pushToken === "string" ? body.pushToken.trim() : "";
    if (!pushToken || pushToken.length > 4096) return json({ error: "INVALID_PUSH_TOKEN" }, 400);

    const existing = await db.from("customer_wallet_device_registrations")
      .select("id")
      .eq("wallet_pass_id", pass.id)
      .eq("device_library_identifier_hash", deviceHash)
      .maybeSingle();
    if (existing.error) return noContent(500);

    const now = new Date().toISOString();
    const upsert = await db.from("customer_wallet_device_registrations").upsert({
      wallet_pass_id: pass.id,
      device_library_identifier_hash: deviceHash,
      push_token: pushToken,
      last_seen_at: now,
      unregistered_at: null,
    }, { onConflict: "wallet_pass_id,device_library_identifier_hash" });
    if (upsert.error) return noContent(500);
    return noContent(existing.data ? 200 : 201);
  }

  // GET /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}
  const isUpdatesRoute = parts.length === 5 && parts[0] === "v1" && parts[1] === "devices" && parts[3] === "registrations";
  if (req.method === "GET" && isUpdatesRoute) {
    const deviceHash = await sha256Hex(parts[2]);
    const requestedPassType = parts[4];
    if (requestedPassType !== passTypeIdentifier()) return noContent(204);

    const registrations = await db.from("customer_wallet_device_registrations")
      .select("wallet_pass_id")
      .eq("device_library_identifier_hash", deviceHash)
      .is("unregistered_at", null)
      .limit(500);
    if (registrations.error || !registrations.data?.length) return noContent(204);

    const ids = [...new Set(registrations.data.map((row) => String(row.wallet_pass_id)))];
    const passes = await db.from("customer_wallet_passes")
      .select("id,apple_serial_number,provider_metadata,status")
      .in("id", ids)
      .eq("status", "active")
      .not("apple_serial_number", "is", null);
    if (passes.error || !passes.data?.length) return noContent(204);

    const previousRaw = url.searchParams.get("passesUpdatedSince");
    const previous = previousRaw && /^\d+$/.test(previousRaw) ? Number(previousRaw) : null;
    const tagged = passes.data.map((pass) => ({ pass, tag: walletUpdateTag(pass.provider_metadata) }));
    const eligible = tagged.filter(({ tag }) => previous === null || tag > previous);
    if (!eligible.length) return noContent(204);

    const lastUpdated = Math.max(...tagged.map(({ tag }) => tag));
    return json({
      serialNumbers: eligible.map(({ pass }) => String(pass.apple_serial_number)),
      lastUpdated: String(lastUpdated),
    });
  }

  // GET /v1/passes/{passTypeIdentifier}/{serialNumber}
  const isPassRoute = parts.length === 4 && parts[0] === "v1" && parts[1] === "passes";
  if (req.method === "GET" && isPassRoute) {
    const requestedPassType = parts[2];
    const serialNumber = parts[3];
    if (requestedPassType !== passTypeIdentifier()) return noContent(401);

    const pass = await findPassBySerial(db, serialNumber);
    if (!pass || !(await verifyApplePassAuthorization(pass, req.headers.get("Authorization")))) return noContent(401);

    try {
      const snapshot = await prepareWalletSnapshot(db, pass.user_id);
      const bytes = await buildSignedPass(snapshot.row, snapshot.data, snapshot.authenticationToken);
      const now = new Date().toISOString();
      await db.from("customer_wallet_passes").update({
        provider_status: "issued",
        last_generated_at: now,
        last_synced_at: now,
      }).eq("id", snapshot.row.id);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.pkpass",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Last-Modified": new Date().toUTCString(),
        },
      });
    } catch (error) {
      console.error("apple-wallet-web-service pass", error instanceof Error ? error.message : "unknown");
      return noContent(500);
    }
  }

  return noContent(404);
});
