// A receipt is sent only to an address already stored server-side for the
// rental. The kiosk must never invent or derive an address from card data.
export function receiptEmailForPaymentIntent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    ? email
    : null;
}
