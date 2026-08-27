const PASS_STUDIO_BASE_URL = "https://www.passstudio.online/api/v1";
const REQUEST_TIMEOUT_MS = 10_000;
export const CHARGEURS_ACCOUNT_PASS_ID = "kBQ15unyRlQPeUhcRWID";

export type PassStudioPass = {
  passId: string;
  name: string;
  passType?: string;
  status?: string;
  distributionMode?: string;
  fieldsEditable?: boolean;
  fieldKeys?: string[];
  fieldLabels?: Record<string, string>;
  templateOwnedFieldKeys?: string[];
};

export type PassStudioIssueResult = {
  instanceId: string;
  passstudioHolderId: string;
  barcodeContent: string;
  shareToken?: string;
  addToWalletUrl: string;
  emailSent?: boolean;
  alreadyExisted?: boolean;
};

export type PassStudioInstanceUpdateResult = {
  ok: boolean;
  instanceId: string;
  updatedFields: string[];
  pushed: boolean;
  providerPushed?: boolean;
  alreadyProcessed?: boolean;
  pushSkipReason?: "no_change" | "insufficient_credits" | "push_failed" | string;
  warnings?: unknown[];
};

export type PassStudioNotificationMessage = string | Record<string, string>;
export type ResolvePassStudioPassOptions = {
  passId?: string | null;
  passName?: string | null;
  allowSoleActiveFallback?: boolean;
};

export class PassStudioError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "PassStudioError";
    this.status = status;
    this.code = code;
  }
}

function safeCode(value: unknown): string {
  const text = String(value ?? "PASS_STUDIO_UNAVAILABLE")
    .toUpperCase().replace(/[^A-Z0-9_:-]/g, "_").slice(0, 96);
  return text || "PASS_STUDIO_UNAVAILABLE";
}

function normalize(value: string | null | undefined): string {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function request<T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${PASS_STUDIO_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new PassStudioError(response.status, safeCode(payload?.code ?? `PASS_STUDIO_HTTP_${response.status}`));
    return payload as T;
  } catch (error) {
    if (error instanceof PassStudioError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new PassStudioError(504, "PASS_STUDIO_TIMEOUT");
    throw new PassStudioError(502, "PASS_STUDIO_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

export function requirePassStudioApiKey(): string {
  const key = (Deno.env.get("PASS_STUDIO_API_KEY") ?? "").trim();
  if (!key) throw new PassStudioError(503, "PASS_STUDIO_NOT_CONFIGURED");
  return key;
}

export async function listPassStudioPasses(apiKey: string): Promise<PassStudioPass[]> {
  const payload = await request<{ passes?: PassStudioPass[] }>(apiKey, "/passes?limit=200");
  return Array.isArray(payload.passes) ? payload.passes : [];
}

export async function resolvePassStudioPass(
  apiKey: string,
  options: ResolvePassStudioPassOptions = {},
): Promise<PassStudioPass> {
  const explicitId = Object.prototype.hasOwnProperty.call(options, "passId");
  const explicitName = Object.prototype.hasOwnProperty.call(options, "passName");
  const accountPass = !explicitId && !explicitName;
  const configuredId = String(explicitId ? options.passId ?? "" : CHARGEURS_ACCOUNT_PASS_ID).trim();
  const configuredName = String(explicitName ? options.passName ?? "" : "").trim();
  const passes = await listPassStudioPasses(apiKey);
  const byId = configuredId ? passes.find((pass) => pass.passId === configuredId) : undefined;
  const wantedName = normalize(configuredName);
  const byName = wantedName ? passes.find((pass) => normalize(pass.name) === wantedName) : undefined;
  const active = passes.filter((pass) => String(pass.status ?? "active").toLowerCase() === "active");
  const sole = accountPass || options.allowSoleActiveFallback === false ? undefined : active.length === 1 ? active[0] : undefined;
  const match = byId ?? byName ?? sole;
  if (!match) throw new PassStudioError(503, accountPass ? "PASS_STUDIO_ACCOUNT_PASS_NOT_FOUND" : "PASS_STUDIO_PASS_ID_OR_NAME_NOT_FOUND");
  if (String(match.status ?? "active").toLowerCase() !== "active") throw new PassStudioError(409, "PASS_STUDIO_PASS_NOT_ACTIVE");
  return match;
}

function editableFields(pass: PassStudioPass, fields: Record<string, string | number | boolean | null>) {
  const editable = new Set(pass.fieldKeys ?? []);
  const owned = new Set(pass.templateOwnedFieldKeys ?? []);
  return Object.fromEntries(Object.entries(fields).filter(([key]) => editable.has(key) && !owned.has(key)));
}

export async function issuePassStudioPass(
  apiKey: string,
  pass: PassStudioPass,
  input: { email: string; name?: string | null; phone?: string | null; fields: Record<string, string | number | boolean | null> },
): Promise<PassStudioIssueResult> {
  return await request<PassStudioIssueResult>(apiKey, `/passes/${encodeURIComponent(pass.passId)}/issue`, {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      ...(input.name ? { name: input.name } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      sendEmail: false,
      resendIfExists: false,
      fields: editableFields(pass, input.fields),
    }),
  });
}

export async function updatePassStudioInstance(
  apiKey: string,
  pass: PassStudioPass,
  instanceId: string,
  fields: Record<string, string | number | boolean | null>,
  message?: PassStudioNotificationMessage | null,
  externalRef?: string | null,
): Promise<PassStudioInstanceUpdateResult> {
  return await request<PassStudioInstanceUpdateResult>(apiKey, "/instances/fields", {
    method: "PATCH",
    body: JSON.stringify({
      instanceId,
      fields: editableFields(pass, fields),
      ...(message ? { message } : {}),
      ...(externalRef ? { externalRef } : {}),
    }),
  });
}
