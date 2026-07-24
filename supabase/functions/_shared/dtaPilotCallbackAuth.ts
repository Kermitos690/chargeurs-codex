import { DTA_PILOT_STATION_ID } from "./dtaPilot.ts";

const encoder = new TextEncoder();

function secret(): string {
  return Deno.env.get("CHARGENOW_CALLBACK_SECRET")
    ?? Deno.env.get("CHARGENOW_CALLBACK_SIGNING_KEY")
    ?? Deno.env.get("CHARGENOW_EVENT_SECRET")
    ?? "";
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function tokenFor(runId: string): Promise<string> {
  const signingSecret = secret();
  if (!signingSecret) throw new Error("CHARGENOW_CALLBACK_AUTH_NOT_CONFIGURED");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`chargeurs.ch:dta-pilot:${DTA_PILOT_STATION_ID}:${runId}`),
  );
  return base64Url(new Uint8Array(signature));
}

export async function buildDtaPilotCallbackUrl(supabaseUrl: string, runId: string): Promise<string> {
  if (!supabaseUrl) throw new Error("SUPABASE_INTERNAL_CONFIG_MISSING");
  const url = new URL("/functions/v1/dta-pilot-callback", supabaseUrl);
  url.searchParams.set("run", runId);
  url.searchParams.set("token", await tokenFor(runId));
  return url.toString();
}

export async function verifyDtaPilotCallback(req: Request, runId: string): Promise<boolean> {
  const url = new URL(req.url);
  if ((url.searchParams.get("run") ?? "") !== runId) return false;
  const provided = req.headers.get("x-chargenow-callback-token")
    ?? url.searchParams.get("token")
    ?? "";
  try {
    return safeEqual(provided, await tokenFor(runId));
  } catch {
    return false;
  }
}
