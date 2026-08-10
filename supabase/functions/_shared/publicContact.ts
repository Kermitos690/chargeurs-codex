export type PublicContactInput = {
  requestType?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  organization?: unknown;
  stationId?: unknown;
  message?: unknown;
  locale?: unknown;
  website?: unknown;
};

export type ValidPublicContact = {
  request_type: "support" | "partner_installation";
  name: string;
  email: string;
  phone: string | null;
  organization: string | null;
  station_id: string | null;
  message: string;
  source_locale: "fr" | "de" | "it" | "en";
};

function optionalText(value: unknown, max: number): string | null {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim();
  return normalized.length <= max ? normalized : null;
}

export function validatePublicContact(input: PublicContactInput):
  | { ok: true; value: ValidPublicContact }
  | { ok: false; code: string } {
  if (typeof input.website === "string" && input.website.trim()) return { ok: false, code: "REQUEST_REJECTED" };
  const requestType = input.requestType;
  if (requestType !== "support" && requestType !== "partner_installation") return { ok: false, code: "INVALID_REQUEST_TYPE" };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (name.length < 2 || name.length > 120) return { ok: false, code: "INVALID_NAME" };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, code: "INVALID_EMAIL" };
  if (message.length < 10 || message.length > 4000) return { ok: false, code: "INVALID_MESSAGE" };
  const phone = optionalText(input.phone, 40);
  if (input.phone && phone === null) return { ok: false, code: "INVALID_PHONE" };
  const organization = optionalText(input.organization, 160);
  if (input.organization && organization === null) return { ok: false, code: "INVALID_ORGANIZATION" };
  const stationId = optionalText(input.stationId, 32);
  if (stationId && !/^[A-Za-z0-9_-]{4,32}$/.test(stationId)) return { ok: false, code: "INVALID_STATION" };
  const locale = input.locale === "de" || input.locale === "it" || input.locale === "en" ? input.locale : "fr";
  return {
    ok: true,
    value: { request_type: requestType, name, email, phone, organization, station_id: stationId, message, source_locale: locale },
  };
}

export async function saltedIpHash(ip: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function originAllowed(origin: string | null, allowedOrigins: string): boolean {
  if (!origin) return false;
  const allowed = allowedOrigins.split(",").map((item) => item.trim()).filter(Boolean);
  return allowed.includes(origin);
}
