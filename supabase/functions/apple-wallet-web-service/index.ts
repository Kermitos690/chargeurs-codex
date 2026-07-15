import { adminClient, sha256Hex } from "../_shared/db.ts";
import { buildSignedPass, resolveVisibleData, visibleDataHash, type WalletPassRow } from "../_shared/appleWallet.ts";

const db = adminClient();
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...noStore },
});

async function authenticate(passType: string, serial: string, req: Request): Promise<WalletPassRow | null> {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^ApplePass\s+/i, "").trim();
  if (!token || token.length > 512) return null;
  const hash = await sha256Hex(token);
  const result = await db.from("wallet_passes").select("*")
    .eq("pass_type_identifier", passType).eq("serial_number", serial)
    .eq("apple_authentication_token_hash", hash).maybeSingle();
  if (result.error || !result.data) return null;
  return result.data as WalletPassRow;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/apple-wallet-web-service/, "");
  try {
    const register = path.match(/^\/v1\/devices\/([^/]+)\/registrations\/([^/]+)\/([^/]+)$/);
    if (register) {
      const device = decodeURIComponent(register[1]).slice(0, 255);
      const passType = decodeURIComponent(register[2]).slice(0, 255);
      const serial = decodeURIComponent(register[3]).slice(0, 255);
      const pass = await authenticate(passType, serial, req);
      if (!pass || pass.status !== "active") return new Response(null, { status: 401 });

      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const pushToken = typeof body.pushToken === "string" ? body.pushToken.trim() : "";
        if (!device || !pushToken || pushToken.length > 512) return json({ error: "INVALID_REGISTRATION" }, 400);
        const existing = await db.from("wallet_device_registrations").select("id")
          .eq("wallet_pass_id", pass.id).eq("device_library_identifier", device).maybeSingle();
        const write = await db.from("wallet_device_registrations").upsert({
          wallet_pass_id: pass.id,
          device_library_identifier: device,
          push_token: pushToken,
          last_seen_at: new Date().toISOString(),
          unregistered_at: null,
        }, { onConflict: "wallet_pass_id,device_library_identifier" });
        if (write.error) return new Response(null, { status: 500 });
        return new Response(null, { status: existing.data ? 200 : 201 });
      }

      if (req.method === "DELETE") {
        const write = await db.from("wallet_device_registrations")
          .update({ unregistered_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })
          .eq("wallet_pass_id", pass.id).eq("device_library_identifier", device);
        return new Response(null, { status: write.error ? 500 : 200 });
      }
      return new Response(null, { status: 405 });
    }

    const updates = path.match(/^\/v1\/devices\/([^/]+)\/registrations\/([^/]+)$/);
    if (updates && req.method === "GET") {
      const device = decodeURIComponent(updates[1]).slice(0, 255);
      const passType = decodeURIComponent(updates[2]).slice(0, 255);
      const sinceRaw = url.searchParams.get("passesUpdatedSince");
      const sinceMs = sinceRaw && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) * 1000 : null;

      const registrations = await db.from("wallet_device_registrations")
        .select("wallet_pass_id")
        .eq("device_library_identifier", device)
        .is("unregistered_at", null);
      if (registrations.error) return new Response(null, { status: 500 });
      const passIds = (registrations.data ?? []).map((row) => row.wallet_pass_id);
      if (!passIds.length) return new Response(null, { status: 204 });

      const passes = await db.from("wallet_passes")
        .select("serial_number,last_updated_at")
        .in("id", passIds)
        .eq("pass_type_identifier", passType)
        .eq("status", "active")
        .order("last_updated_at", { ascending: false });
      if (passes.error) return new Response(null, { status: 500 });
      const filtered = (passes.data ?? []).filter((row) => sinceMs === null || new Date(row.last_updated_at).getTime() > sinceMs);
      if (!filtered.length) return new Response(null, { status: 204 });
      const latest = Math.max(...filtered.map((row) => new Date(row.last_updated_at).getTime()));
      return json({
        serialNumbers: filtered.map((row) => row.serial_number),
        lastUpdated: String(Math.floor(latest / 1000)),
      });
    }

    const retrieve = path.match(/^\/v1\/passes\/([^/]+)\/([^/]+)$/);
    if (retrieve && req.method === "GET") {
      const passType = decodeURIComponent(retrieve[1]).slice(0, 255);
      const serial = decodeURIComponent(retrieve[2]).slice(0, 255);
      const pass = await authenticate(passType, serial, req);
      if (!pass || pass.status !== "active") return new Response(null, { status: 401 });
      const authUser = await db.auth.admin.getUserById(pass.user_id);
      if (authUser.error || !authUser.data.user) return new Response(null, { status: 404 });
      const visible = await resolveVisibleData(db, pass.user_id, authUser.data.user.email ?? null);
      const hash = await visibleDataHash(visible);
      if (pass.visible_data_hash !== hash) {
        const touched = await db.rpc("touch_wallet_pass", {
          p_pass_id: pass.id,
          p_reason: "apple_update_request",
          p_visible_data_hash: hash,
        });
        if (!touched.error && typeof touched.data === "number") {
          pass.pass_version = touched.data;
          pass.visible_data_hash = hash;
          pass.last_updated_at = new Date().toISOString();
        }
      }
      const bytes = await buildSignedPass(pass, visible);
      await db.from("wallet_passes").update({ last_generated_at: new Date().toISOString() }).eq("id", pass.id);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.pkpass",
          "Last-Modified": new Date(pass.last_updated_at).toUTCString(),
          ...noStore,
        },
      });
    }

    if (path === "/v1/log" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const logs = Array.isArray(body.logs)
        ? body.logs.slice(0, 20).map((value: unknown) => String(value).replace(/w[aq]_[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500))
        : [];
      await db.from("api_logs").insert({
        service: "apple_wallet",
        endpoint: "/v1/log",
        method: "POST",
        status_code: 200,
        request: { logs },
        response: null,
        error: null,
      });
      return new Response(null, { status: 200 });
    }

    return new Response(null, { status: 404 });
  } catch {
    return new Response(null, { status: 500 });
  }
});
