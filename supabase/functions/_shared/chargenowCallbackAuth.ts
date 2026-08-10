// Per-rental authentication for ChargeNow callback URLs.
//
// The raw signing key remains in the Edge Function environment. New callback
// URLs receive only an HMAC token scoped to one rental. A legacy provider setup
// may instead send the global event secret in a header; global secrets are never
// accepted from query parameters.

const encoder = new TextEncoder();

function signingSecret(): string {
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

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function chargeNowCallbackToken(rentalId: string): Promise<string> {
  const secret = signingSecret();
  if (!secret) throw new Error("CHARGENOW_CALLBACK_AUTH_NOT_CONFIGURED");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`chargeurs.ch:chargenow-callback:${rentalId}`),
  );
  return base64Url(new Uint8Array(signature));
}

export async function buildChargeNowCallbackUrl(
  supabaseUrl: string,
  rentalId: string,
): Promise<string> {
  if (!supabaseUrl) throw new Error("SUPABASE_INTERNAL_CONFIG_MISSING");
  const url = new URL("/functions/v1/chargenow-rent-callback", supabaseUrl);
  // The callback handler resolves the rental from the provider trade number
  // before verification. Emitting a single query parameter avoids the
  // provider's historic HTML rewrite of `&token` into `amp;token`.
  // The HMAC remains scoped to one rental and cannot authenticate another one.
  url.searchParams.set("token", await chargeNowCallbackToken(rentalId));
  return url.toString();
}

export async function verifyChargeNowCallback(
  req: Request,
  rentalId: string,
): Promise<boolean> {
  const legacySecret = Deno.env.get("CHARGENOW_CALLBACK_SECRET")
    ?? Deno.env.get("CHARGENOW_EVENT_SECRET")
    ?? "";
  const legacyHeader = req.headers.get("x-event-secret")
    ?? req.headers.get("x-chargenow-secret")
    ?? "";
  if (legacySecret && safeEqual(legacyHeader, legacySecret)) return true;

  const url = new URL(req.url);
  // Older provider callbacks were generated through an HTML context and can
  // arrive with a query key named `amp;token`. Keep compatibility only for a
  // rental-scoped HMAC: newly generated URLs always use canonical `&token=`.
  // This fixes in-flight historical orders without accepting a global secret
  // from the query string or perpetuating the malformed URL format.
  const provided = req.headers.get("x-chargenow-callback-token")
    ?? url.searchParams.get("token")
    ?? url.searchParams.get("amp;token")
    ?? "";
  const scopedRental = url.searchParams.get("rental") ?? rentalId;
  if (scopedRental !== rentalId) return false;

  try {
    return safeEqual(provided, await chargeNowCallbackToken(rentalId));
  } catch {
    return false;
  }
}
