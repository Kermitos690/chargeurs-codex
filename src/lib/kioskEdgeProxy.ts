/**
 * Invoke kiosk-sensitive Edge Functions through the staging application's own
 * HTTPS origin. Some industrial Android WebViews load the Vercel kiosk page
 * correctly but abort a cross-origin `fetch` to Supabase after preflight.
 *
 * Vercel only relays the request; Supabase remains the authentication and
 * authorization boundary. The station-bound kiosk token stays in a request
 * header, is never placed in a URL, and is still hashed/verified by the Edge
 * Function.
 */
const PUBLIC_SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export type KioskProxyResult<T> = {
  data: T | null;
  transportError: boolean;
};

export async function invokeKioskEdgeProxy<T>(
  path: "/api/kiosk/create-rental-session" | "/api/kiosk/create-stripe-checkout" | "/api/kiosk/cabinet-snapshot" | "/api/kiosk/reconcile-pending-ejection",
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<KioskProxyResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        // The key is publishable and already bundled for every Supabase web
        // request. It is required by the Supabase gateway, not a secret.
        apikey: PUBLIC_SUPABASE_KEY,
        Authorization: `Bearer ${PUBLIC_SUPABASE_KEY}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });

    let data: T | null = null;
    try {
      data = await response.json() as T;
    } catch {
      // A non-JSON gateway error is treated as a safe request failure below.
    }
    return { data, transportError: !response.ok && data === null };
  } catch {
    return { data: null, transportError: true };
  }
}
