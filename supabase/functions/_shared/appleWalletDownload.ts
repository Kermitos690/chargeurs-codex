import type { CustomerWalletPassRow } from "./appleWallet.ts";

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
}

async function sign(input: string): Promise<string> {
  const secret = Deno.env.get("APPLE_WALLET_AUTH_SECRET")?.trim() ?? "";
  if (new TextEncoder().encode(secret).length < 32) throw new Error("APPLE_WALLET_AUTH_SECRET_TOO_SHORT");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input))));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

export async function createWalletDownloadToken(row: CustomerWalletPassRow, ttlSeconds = 300): Promise<{ token: string; expiresAt: string }> {
  const expires = Math.floor(Date.now() / 1000) + Math.min(Math.max(ttlSeconds, 60), 600);
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ p: row.public_pass_id, e: expires })));
  return {
    token: `${payload}.${await sign(payload)}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

export async function verifyWalletDownloadToken(token: string): Promise<{ publicPassId: string } | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = await sign(payload);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { p?: unknown; e?: unknown };
    if (typeof decoded.p !== "string" || !decoded.p || typeof decoded.e !== "number") return null;
    if (!Number.isFinite(decoded.e) || decoded.e < Math.floor(Date.now() / 1000) || decoded.e > Math.floor(Date.now() / 1000) + 660) return null;
    return { publicPassId: decoded.p };
  } catch {
    return null;
  }
}
