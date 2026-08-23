import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { strFromU8, unzipSync } from "npm:fflate@0.8.2";
import { requirePassStudioApiKey, resolvePassStudioPass } from "./passStudio.ts";

type WalletFieldSummary = {
  section: string;
  key: string | null;
  label: string | null;
  changeMessage: string | null;
};

function summarizePassJson(passJson: Record<string, unknown>) {
  const passKinds = ["storeCard", "generic", "coupon", "eventTicket", "boardingPass"];
  const passKind = passKinds.find((key) => passJson[key] && typeof passJson[key] === "object") ?? null;
  const container = passKind ? (passJson[passKind] as Record<string, unknown>) : {};
  const sections = ["headerFields", "primaryFields", "secondaryFields", "auxiliaryFields", "backFields"];
  const fields: WalletFieldSummary[] = [];

  for (const section of sections) {
    const raw = container[section];
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const field = item as Record<string, unknown>;
      fields.push({
        section,
        key: typeof field.key === "string" ? field.key : null,
        label: typeof field.label === "string" ? field.label : null,
        changeMessage: typeof field.changeMessage === "string" ? field.changeMessage : null,
      });
    }
  }

  const locations = Array.isArray(passJson.locations)
    ? passJson.locations.map((entry) => {
      const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      return {
        hasCoordinates: typeof row.latitude === "number" && typeof row.longitude === "number",
        relevantText: typeof row.relevantText === "string" ? row.relevantText : null,
      };
    })
    : [];

  return {
    formatVersion: passJson.formatVersion ?? null,
    passKind,
    organizationName: typeof passJson.organizationName === "string" ? passJson.organizationName : null,
    description: typeof passJson.description === "string" ? passJson.description : null,
    hasWebServiceURL: typeof passJson.webServiceURL === "string" && passJson.webServiceURL.length > 0,
    hasAuthenticationToken: typeof passJson.authenticationToken === "string" && passJson.authenticationToken.length > 0,
    relevantDatePresent: typeof passJson.relevantDate === "string",
    locations,
    fields,
    changeMessageFields: fields.filter((field) => Boolean(field.changeMessage)),
    userInfoKeys: passJson.userInfo && typeof passJson.userInfo === "object"
      ? Object.keys(passJson.userInfo as Record<string, unknown>).sort()
      : [],
  };
}

function safeProviderPassSummary(providerPass: Record<string, unknown>) {
  return {
    keys: Object.keys(providerPass).sort(),
    passId: typeof providerPass.passId === "string" ? providerPass.passId : null,
    name: typeof providerPass.name === "string" ? providerPass.name : null,
    passType: typeof providerPass.passType === "string" ? providerPass.passType : null,
    status: typeof providerPass.status === "string" ? providerPass.status : null,
    distributionMode: typeof providerPass.distributionMode === "string" ? providerPass.distributionMode : null,
    fieldsEditable: providerPass.fieldsEditable ?? null,
    fieldKeys: Array.isArray(providerPass.fieldKeys) ? providerPass.fieldKeys : [],
    templateOwnedFieldKeys: Array.isArray(providerPass.templateOwnedFieldKeys) ? providerPass.templateOwnedFieldKeys : [],
  };
}

export async function inspectPassStudioPkpass(db: SupabaseClient) {
  const { data: wallet, error: walletError } = await db.from("customer_wallet_passes")
    .select("provider_add_to_wallet_url")
    .eq("provider", "pass_studio")
    .eq("provider_status", "issued")
    .not("provider_add_to_wallet_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (walletError || !wallet?.provider_add_to_wallet_url) {
    return { ok: false, error: "WALLET_INSTANCE_NOT_AVAILABLE" };
  }

  const shareUrl = new URL(String(wallet.provider_add_to_wallet_url));
  const token = shareUrl.pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (!token) return { ok: false, error: "PASS_STUDIO_SHARE_TOKEN_MISSING" };

  const apiKey = requirePassStudioApiKey();
  const providerPass = await resolvePassStudioPass(apiKey) as unknown as Record<string, unknown>;
  const downloadUrl = `https://www.passstudio.online/api/i/${encodeURIComponent(token)}/download?platform=apple`;
  const response = await fetch(downloadUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      "Accept": "application/vnd.apple.pkpass,application/octet-stream;q=0.9,*/*;q=0.1",
    },
  });

  if (!response.ok) {
    return {
      ok: false,
      error: `PASS_STUDIO_PKPASS_HTTP_${response.status}`,
      contentType: response.headers.get("content-type"),
      providerPass: safeProviderPassSummary(providerPass),
    };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const archive = unzipSync(bytes);
  const passJsonBytes = archive["pass.json"];
  if (!passJsonBytes) {
    return { ok: false, error: "PASS_JSON_NOT_FOUND", providerPass: safeProviderPassSummary(providerPass) };
  }

  const passJson = JSON.parse(strFromU8(passJsonBytes)) as Record<string, unknown>;
  return {
    ok: true,
    contentType: response.headers.get("content-type"),
    archiveFiles: Object.keys(archive).sort(),
    providerPass: safeProviderPassSummary(providerPass),
    passJson: summarizePassJson(passJson),
  };
}
