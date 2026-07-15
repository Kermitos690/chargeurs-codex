// Per-rental authentication for ChargeNow callback URLs.
//
// The raw signing key remains in the Edge Function environment. The callback URL
// receives only an HMAC token scoped to one rental. A leaked callback URL cannot
// authenticate callbacks for another rental.

const encoder = new TextEncoder();

function signingSecret(): string {
  return Deno.env.get("CHARGENOW_CALLBACK_SIGNING_KEY")
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
  url.searchParams.set("rental", rentalId);
  url.searchParams.set("token", await chargeNowCallbackToken(rentalId));
  return url.toString();
}

export async function verifyChargeNowCallback(
  req: Request,
  rentalId: string,
): Promise<boolean> {
  const url = new URL(req.url);
  const provided = req.headers.get("x-chargenow-callback-token")
    ?? url.searchParams.get("token")
    ?? "";
  const scopedRental = url.searchParams.get("rental") ?? rentalId;
  if (scopedRental !== rentalId) return false;

  try {
    return safeEqual(provided, await chargeNowCallbackToken(rentalId));
  } catch {
    return false;
  }
}
