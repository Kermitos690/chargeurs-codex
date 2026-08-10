const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|secret|token|api[_-]?key|signature|card(?:_number)?|cvc|cvv|email|phone|address)/i;
const MAX_STRING_LENGTH = 512;
const MAX_DEPTH = 8;

/**
 * Defense in depth for the staging test-monitor. Server logs are already
 * redacted, but an admin export must never become a way to copy a credential
 * or another customer's contact details to a local file.
 */
export function redactAdminReportValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]` : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactAdminReportValue(item, depth + 1));

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    key,
    SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactAdminReportValue(nested, depth + 1),
  ]));
}

export function redactAdminReportRows(rows: unknown[]): unknown[] {
  return rows.map((row) => redactAdminReportValue(row));
}
