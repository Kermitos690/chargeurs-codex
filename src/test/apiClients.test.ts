import { describe, expect, it } from "vitest";

// Mirror of the client-side key generator used by AdminApiClients.tsx.
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function generateRawKey(env: "test" | "live") {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const prefix = env === "live" ? "chg_live_" : "chg_test_";
  return { raw: `${prefix}${suffix}`, prefix, publicId: suffix.slice(0, 12) };
}

describe("api client key generation", () => {
  it("emits prefixed random keys", () => {
    const t = generateRawKey("test");
    expect(t.raw).toMatch(/^chg_test_[a-f0-9]{48}$/);
    expect(t.publicId).toHaveLength(12);
    const l = generateRawKey("live");
    expect(l.raw).toMatch(/^chg_live_[a-f0-9]{48}$/);
  });
  it("hashes deterministically to 64 hex chars", async () => {
    const h1 = await sha256Hex("chg_test_abc");
    const h2 = await sha256Hex("chg_test_abc");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
    expect(h1).toMatch(/^[a-f0-9]+$/);
  });
  it("two consecutive keys are distinct with overwhelming probability", () => {
    const a = generateRawKey("test").raw;
    const b = generateRawKey("test").raw;
    expect(a).not.toBe(b);
  });
});
