import { adminClient, sha256Hex } from "../_shared/db.ts";
import { buildSignedPass, decryptToken, resolveVisibleData, visibleDataHash, walletConfig } from "../_shared/appleWallet.ts";

const db = adminClient();
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...noStore } });

async function authenticate(passType: string, serial: string, req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^ApplePass\s+/i, "").trim();
  if (!token) return null;
  const hash = await sha256Hex(token);
  const result = await db.from("wallet_passes").select("*")
    .eq("pass_type_identifier", passType).eq("serial_number", serial)
    .eq("apple_authentication_token_hash", hash).maybeSingle();
  return result.data ?? null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/apple-wallet-web-service/, "");
  try {
    const register = path.match(/^\/v1\/devices\/([^/]+)\/registrations\/([^/]+)\/([^/]+)$/);
    if (register) {
      const [, device, passType, serial] = register.map(decodeURIComponent);
      const pass = await authenticate(passType, serial, req);
      if (!pass || pass.status !== "active") return new Response(null, { status: 401 });
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const pushToken = typeof body.pushToken === "string" ? body.pushToken.trim() : "";
        if (!pushToken || pushToken.length > 512) return json({ error: "INVALID_PUSH_TOKEN" }, 400);
        const existing = await db.from("wallet_device_registrations").select("id")
          .eq("wallet_pass_id", pass.id).eq("device_library_identifier", device).maybeSingle();
        await db.from("wallet_device_registrations").upsert({
          wallet_pass_id: pass.id, device_library_identifier: device, push_token: pushToken,
          last_seen_at: new Date().toISOString(), unregistered_at: null,
        }, { onConflict: "wallet_pass_id,device_library_identifier" });
        return new Response(null, { status: existing.data ? 200 : 201 });
      }
      if (req.method === "DELETE") {
        await db.from("wallet_device_registrations").update({ unregistered_at: new Date().toISOString() })
          .eq("wallet_pass_id", pass.id).eq("device_library_identifier", device);
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 405 });
    }

    const updates = path.match(/^\/v1\/devices\/([^/]+)\/registrations\/([^/]+)$/);
    if (updates && req.method === "GET") {
      const device = decodeURIComponent(updates[1]);
      const passType = decodeURIComponent(updates[2]);
      const since = url.searchParams.get("passesUpdatedSince");
      const registration = await db.from("wallet_device_registrations")
        .select("wallet_passes!inner(serial_number,last_updated_at,pass_type_identifier,status)")
        .eq("device_library_identifier", device).is("unregistered_at", null)
        .eq("wallet_passes.pass_type_identifier", passType).eq("wallet_passes.status", "active");
      const rows = (registration.data ?? []) as Array<{ wallet_passes: { serial_number: string; last_updated_at: string } }>;
      const filtered = since ? rows.filter((r) => new Date(r.wallet_passes.last_updated_at).getTime() > Number(since) * 1000) : rows;
      if (!filtered.length) return new Response(null, { status: 204 });
      const latest = Math.max(...filtered.map((r) => new Date(r.wallet_passes.last_updated_at).getTime()));
      return json({ serialNumbers: filtered.map((r) => r.wallet_passes.serial_number), lastUpdated: String(Math.floor(latest / 1000)) });
    }

    const retrieve = path.match(/^\/v1\/passes\/([^/]+)\/([^/]+)$/);
    if (retrieve && req.method === "GET") {
      const passType = decodeURIComponent(retrieve[1]);
      const serial = decodeURIComponent(retrieve[2]);
      const pass = await authenticate(passType, serial, req);
      if (!pass || pass.status !== "active") return new Response(null, { status: 401 });
      const authUser = await db.auth.admin.getUserById(pass.user_id);
      const visible = await resolveVisibleData(db, pass.user_id, authUser.data.user?.email ?? null);
      const hash = await visibleDataHash(visible);
      if (pass.visible_data_hash !== hash) {
        await db.rpc("touch_wallet_pass", { p_pass_id: pass.id, p_reason: "apple_update_request", p_visible_data_hash: hash });
      }
      const bytes = await buildSignedPass(pass, visible);
      return new Response(bytes, { status: 200, headers: { "Content-Type": "application/vnd.apple.pkpass", "Last-Modified": new Date(pass.last_updated_at).toUTCString(), ...noStore } });
    }

    if (path === "/v1/log" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const logs = Array.isArray(body.logs) ? body.logs.slice(0, 20).map((v: unknown) => String(v).slice(0, 500)) : [];
      await db.from("api_logs").insert({ service: "apple_wallet", endpoint: "/v1/log", method: "POST", status_code: 200, request: { logs }, response: null, error: null });
      return new Response(null, { status: 200 });
    }

    return new Response(null, { status: 404 });
  } catch {
    return new Response(null, { status: 500 });
  }
});
