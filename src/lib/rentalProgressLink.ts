const RENTAL_PROGRESS_STATES = new Set([
  "payment_succeeded",
  "ejecting",
  "ejected",
  "active_rental",
  "battery_taken",
  "battery_returned",
  "completed",
]);

export function shouldShowRentalProgress(state: string | null | undefined) {
  return typeof state === "string" && RENTAL_PROGRESS_STATES.has(state);
}

export function rentalProgressPath(
  rentalSessionId: string,
  publicCode: string,
  language: "fr" | "en" | "de" = "fr",
) {
  const query = new URLSearchParams({ c: publicCode, lang: language });
  return `/pay/${encodeURIComponent(rentalSessionId)}/progress?${query.toString()}`;
}

export function rentalProgressUrl(
  origin: string,
  rentalSessionId: string,
  publicCode: string,
  language: "fr" | "en" | "de" = "fr",
) {
  return new URL(rentalProgressPath(rentalSessionId, publicCode, language), origin).toString();
}
