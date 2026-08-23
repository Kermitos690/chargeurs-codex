const PASS_STUDIO_BASE_URL = "https://www.passstudio.online/api/v1";
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_PASS_STUDIO_PASS_ID = "kBQ15unyR1QPeUhcRWID";

export type PassStudioPass = {
  passId: string;
  name: string;
  passType?: string;
  status?: string;
  distributionMode?: string;
  fieldsEditable?: boolean;
  fieldKeys?: string[];
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
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]/g, "_")
    .slice(0, 96);
  return text || "PASS_STUDIO_UNAVAILABLE";
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
    if (!response.ok) {
      throw new PassStudioError(response.status, safeCode(payload?.code ?? `PASS_STUDIO_HTTP_${response.status}`));
    }
    return payload as T;
  } catch (error) {
    if (error instanceof PassStudioError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new PassStudioError(504, "PASS_STUDIO_TIMEOUT");
    }
    throw new PassStudioError(502, "PASS_STUDIO_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

export function requirePassStudioApiKey(): string {
  const apiKey = (Deno.env.get("PASS_STUDIO_API_KEY") ?? "").trim();
  if (!apiKey) throw new PassStudioError(503, "PASS_STUDIO_NOT_CONFIGURED");
  return apiKey;
}

export async function listPassStudioPasses(apiKey: string): Promise<PassStudioPass[]> {
  const payload = await request<{ passes?: PassStudioPass[] }>(apiKey, "/passes?limit=200");
  return Array.isArray(payload.passes) ? payload.passes : [];
}

export async function resolvePassStudioPass(apiKey: string): Promise<PassStudioPass> {
  const configuredId = (Deno.env.get("PASS_STUDIO_PASS_ID") ?? DEFAULT_PASS_STUDIO_PASS_ID).trim();
  const configuredName = (Deno.env.get("PASS_STUDIO_PASS_NAME") ?? "Chargeurs+").trim().toLocaleLowerCase();
  const passes = await listPassStudioPasses(apiKey);
  const match = configuredId
    ? passes.find((pass) => pass.passId === configuredId)
    : passes.find((pass) => pass.name.trim().toLocaleLowerCase() === configuredName);
  if (!match) throw new PassStudioError(503, configuredId ? "PASS_STUDIO_PASS_ID_NOT_FOUND" : "PASS_STUDIO_PASS_NOT_FOUND");
  if (String(match.status ?? "active").toLowerCase() !== "active") {
    throw new PassStudioError(409, "PASS_STUDIO_PASS_NOT_ACTIVE");
  }
  return match;
}

function editableFields(pass: PassStudioPass, fields: Record<string, string | number | boolean | null>) {
  const editable = new Set(pass.fieldKeys ?? []);
  const templateOwned = new Set(pass.templateOwnedFieldKeys ?? []);
  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => editable.has(key) && !templateOwned.has(key)),
  );
}

export async function issuePassStudioPass(
  apiKey: string,
  pass: PassStudioPass,
  input: {
    email: string;
    name?: string | null;
    phone?: string | null;
    fields: Record<string, string | number | boolean | null>;
  },
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
): Promise<PassStudioInstanceUpdateResult> {
  return await request<PassStudioInstanceUpdateResult>(apiKey, "/instances/fields", {
    method: "PATCH",
    body: JSON.stringify({
      instanceId,
      fields: editableFields(pass, fields),
    }),
  });
}
