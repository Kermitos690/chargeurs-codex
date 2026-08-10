export type StripeRuntimeConfig = {
  ok: boolean;
  secretKey: string;
  webhookSecret: string;
  error: string | null;
};

type StripeRuntimeInput = {
  mode?: string;
  liveEnabled?: string;
  secretKey?: string;
  webhookSecret?: string;
  requireWebhookSecret?: boolean;
};

/**
 * Fail closed unless the deployment is explicitly test-only and the key is a
 * Stripe test key. This prevents an accidental live key from bypassing the
 * STRIPE_LIVE_ENABLED feature flag.
 */
export function validateStripeTestRuntime(
  input: StripeRuntimeInput = {},
): StripeRuntimeConfig {
  const mode = (input.mode ?? Deno.env.get("STRIPE_MODE") ?? "").trim()
    .toLowerCase();
  const liveEnabled =
    (input.liveEnabled ?? Deno.env.get("STRIPE_LIVE_ENABLED") ?? "").trim()
      .toLowerCase();
  const secretKey = (input.secretKey ?? Deno.env.get("STRIPE_SECRET_KEY") ?? "")
    .trim();
  const webhookSecret =
    (input.webhookSecret ?? Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "").trim();

  if (mode !== "test") {
    return {
      ok: false,
      secretKey: "",
      webhookSecret: "",
      error: "STRIPE_TEST_MODE_REQUIRED",
    };
  }
  if (liveEnabled !== "false") {
    return {
      ok: false,
      secretKey: "",
      webhookSecret: "",
      error: "STRIPE_LIVE_DISABLED_REQUIRED",
    };
  }
  if (!(secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_"))) {
    return {
      ok: false,
      secretKey: "",
      webhookSecret: "",
      error: "STRIPE_TEST_KEY_REQUIRED",
    };
  }
  if (input.requireWebhookSecret && !webhookSecret.startsWith("whsec_")) {
    return {
      ok: false,
      secretKey: "",
      webhookSecret: "",
      error: "STRIPE_WEBHOOK_SECRET_REQUIRED",
    };
  }

  return { ok: true, secretKey, webhookSecret, error: null };
}
