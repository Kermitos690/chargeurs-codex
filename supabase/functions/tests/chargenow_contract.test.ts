// CONTRACT tests for the real ChargeNow client (_shared/chargenow.ts).
// The HTTP layer is stubbed; the production parsing/error-mapping code runs as-is.
//
// Contract provenance:
//  - Routes/methods: DEDUCED FROM IMPLEMENTATION + Apifox docs already integrated.
//  - Success envelope {code:0}: CONFIRMED by documentation.
//  - HTTP error mapping (HTTP_<status>): DEDUCED FROM IMPLEMENTATION.
//  - Exact business error codes per endpoint: HYPOTHESIS — validate manually.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stubFetch, jsonResponse } from "./_fakes.ts";

// Configure BEFORE first import so the module-level auth picks it up.
Deno.env.set("CHARGENOW_BASIC_AUTH", "dGVzdC10b2tlbg==");
Deno.env.set("CHARGENOW_API_BASE_URL", "https://example.test/cdb-open-api/v1");
const cn = await import("../_shared/chargenow.ts");

Deno.test("isChargeNowConfigured true when BASIC_AUTH set", () => {
  assert(cn.isChargeNowConfigured());
});

Deno.test("cabinet query — normal success (code:0)", async () => {
  const s = stubFetch(() => jsonResponse({ code: 0, data: { cabinet: { online: true, slots: 4 } } }));
  try {
    const res = await cn.cabinetQuery("DTA21277");
    assertEquals(res.ok, true);
    assertEquals(res.status, 200);
    assertEquals(res.error, null);
    assert(s.calls[0].url.includes("deviceId=DTA21277"));
    // Auth header must be sent on every call.
    assert((s.calls[0].init?.headers as Record<string, string>).Authorization.startsWith("Basic "));
  } finally { s.restore(); }
});

Deno.test("cabinet query — business failure (code:1) maps to error", async () => {
  const s = stubFetch(() => jsonResponse({ code: 1, msg: "device not found" }));
  try {
    const res = await cn.cabinetQuery("UNKNOWN");
    assertEquals(res.ok, false);
    assert(res.error?.includes("CODE_1"));
  } finally { s.restore(); }
});

for (const status of [400, 401, 403, 404, 409, 429, 500]) {
  Deno.test(`cabinet query — HTTP ${status} surfaces error, ok=false`, async () => {
    const s = stubFetch(() => jsonResponse({ message: "err" }, status));
    try {
      const res = await cn.cabinetQuery("DTA");
      assertEquals(res.ok, false);
      assertEquals(res.status, status);
      assert(res.error?.startsWith(`HTTP_${status}`));
    } finally { s.restore(); }
  });
}

Deno.test("cabinet query — non-JSON body does not throw", async () => {
  const s = stubFetch(() => new Response("<html>oops</html>", { status: 200 }));
  try {
    const res = await cn.cabinetQuery("DTA");
    // HTTP ok and no JSON code -> treated as ok; data is raw string.
    assertEquals(res.status, 200);
    assertEquals(typeof res.data, "string");
  } finally { s.restore(); }
});

Deno.test("cabinet query — network failure returns error, ok=false (no throw)", async () => {
  const s = stubFetch(() => { throw new Error("ECONNREFUSED"); });
  try {
    const res = await cn.cabinetQuery("DTA");
    assertEquals(res.ok, false);
    assertEquals(res.status, 0);
    assert(res.error?.includes("ECONNREFUSED"));
  } finally { s.restore(); }
});

Deno.test("order close — sends auth and parses success", async () => {
  const s = stubFetch(() => jsonResponse({ code: 0 }));
  try {
    const res = await cn.orderClose({ tradeNo: "T-1" });
    assertEquals(res.ok, true);
    assert((s.calls[0].init?.headers as Record<string, string>).Authorization.startsWith("Basic "));
  } finally { s.restore(); }
});
