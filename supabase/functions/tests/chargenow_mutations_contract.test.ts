// ============================================================
// LEVEL A — CONTRACT TESTS for ChargeNow MUTATIONS (no hardware).
//
// Goal: prove every mutation is correctly BUILT, SECURED, MAPPED and
// RECOVERABLE — without ever running a destructive op against real hardware.
//
// Covered mutations (the unverified + blocked_by_safety set):
//   O2 orderCreate, O3 orderQuery, O4 orderClose
//   S3 shopCreate, S4 shopUpdate, S5 shopDelete (blocked)
//   P3 priceStrategySave, P4 priceStrategyDelete (blocked),
//   P5 priceStrategyBind, P6 priceStrategyUnbind
//   C1 cabinetOperation (blocked), C2 ejectByRepair (blocked),
//   C3 ejectByRent (blocked), E1 eventPushConfig (blocked)
//
// For each: verify HTTP method, URL/path, query OR body payload, the auth
// header, success mapping ({code:0}), business-error mapping ({code:n}),
// HTTP error mapping (400/401/403/404/409/429/500), malformed body and
// network failure handling.
//
// Contract provenance:
//  - Routes/methods/params: from _shared/chargenow.ts (Apifox-integrated).
//  - Success envelope {code:0}: CONFIRMED by documentation.
//  - Exact per-endpoint business codes: HYPOTHESIS — validate on live/physical.
// ============================================================
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonResponse, stubFetch } from "./_fakes.ts";

Deno.env.set("CHARGENOW_BASIC_AUTH", "dGVzdC10b2tlbg==");
Deno.env.set("CHARGENOW_API_BASE_URL", "https://example.test/cdb-open-api/v1");
const cn = await import("../_shared/chargenow.ts");

const HTTP_ERRORS = [400, 401, 403, 404, 409, 429, 500] as const;

type ApiResult = Awaited<ReturnType<typeof cn.cabinetQuery>>;

// Generic helper: run an op, assert success mapping + auth header present.
async function expectSuccess(
  run: () => Promise<ApiResult>,
  assertCall: (call: { url: string; init?: RequestInit }) => void,
) {
  const s = stubFetch(() => jsonResponse({ code: 0, data: { ok: true } }));
  try {
    const res = await run();
    assertEquals(res.ok, true, "expected ok=true on {code:0}");
    assertEquals(res.status, 200);
    assertEquals(res.error, null);
    const call = s.calls[0];
    const auth = (call.init?.headers as Record<string, string>).Authorization;
    assert(auth?.startsWith("Basic "), "auth header (Basic) must be sent on every mutation");
    assertCall(call);
  } finally { s.restore(); }
}

// Generic helper: assert every HTTP error status maps to ok=false + HTTP_<n>.
async function expectHttpErrors(run: () => Promise<cn.ApiResult>) {
  for (const status of HTTP_ERRORS) {
    const s = stubFetch(() => jsonResponse({ message: "err" }, status));
    try {
      const res = await run();
      assertEquals(res.ok, false, `HTTP ${status} must map ok=false`);
      assertEquals(res.status, status);
      assert(res.error?.startsWith(`HTTP_${status}`), `error must include HTTP_${status}`);
    } finally { s.restore(); }
  }
}

// Generic helper: business failure {code:n!=0} and malformed/network handling.
async function expectResilience(run: () => Promise<cn.ApiResult>) {
  // Business error code surfaced.
  let s = stubFetch(() => jsonResponse({ code: 9, msg: "rejected" }));
  try {
    const res = await run();
    assertEquals(res.ok, false);
    assert(res.error?.includes("CODE_9"));
  } finally { s.restore(); }
  // Malformed (non-JSON) body does not throw.
  s = stubFetch(() => new Response("<html>500</html>", { status: 200 }));
  try {
    const res = await run();
    assertEquals(res.status, 200);
  } finally { s.restore(); }
  // Network failure -> ok=false, status 0, no throw.
  s = stubFetch(() => { throw new Error("ECONNREFUSED"); });
  try {
    const res = await run();
    assertEquals(res.ok, false);
    assertEquals(res.status, 0);
    assert(res.error?.includes("ECONNREFUSED"));
  } finally { s.restore(); }
}

// ----------------------------------------------------------------
// O2 — Create Rent Order (POST /rent/order/create?deviceId&callbackURL)
// ----------------------------------------------------------------
Deno.test("O2 orderCreate — builds POST with deviceId + callbackURL query", async () => {
  await expectSuccess(
    () => cn.orderCreate({ deviceId: "DTA21277", callbackURL: "https://cb.test/x" }),
    (c) => {
      assertEquals(c.init?.method, "POST");
      assert(c.url.includes("/rent/order/create"));
      assert(c.url.includes("deviceId=DTA21277"));
      assert(c.url.includes("callbackURL=https"));
    },
  );
});
Deno.test("O2 orderCreate — HTTP errors mapped", () => expectHttpErrors(() => cn.orderCreate({ deviceId: "DTA21277" })));
Deno.test("O2 orderCreate — resilience", () => expectResilience(() => cn.orderCreate({ deviceId: "DTA21277" })));

// ----------------------------------------------------------------
// O3 — Query Rent Order Status (POST /rent/order/query?tradeNo) — idempotent
// ----------------------------------------------------------------
Deno.test("O3 orderQuery — builds POST with tradeNo query", async () => {
  await expectSuccess(
    () => cn.orderQuery("T-123"),
    (c) => {
      assertEquals(c.init?.method, "POST");
      assert(c.url.includes("/rent/order/query"));
      assert(c.url.includes("tradeNo=T-123"));
    },
  );
});
Deno.test("O3 orderQuery — HTTP errors mapped", () => expectHttpErrors(() => cn.orderQuery("T-1")));
Deno.test("O3 orderQuery — resilience", () => expectResilience(() => cn.orderQuery("T-1")));

// ----------------------------------------------------------------
// O4 — Close / Mark Completed (POST /rent/order/close?tradeNo)
// ----------------------------------------------------------------
Deno.test("O4 orderClose — builds POST with tradeNo (object or string)", async () => {
  await expectSuccess(
    () => cn.orderClose({ tradeNo: "T-9" }),
    (c) => {
      assertEquals(c.init?.method, "POST");
      assert(c.url.includes("/rent/order/close"));
      assert(c.url.includes("tradeNo=T-9"));
    },
  );
  await expectSuccess(
    () => cn.orderClose("T-str"),
    (c) => assert(c.url.includes("tradeNo=T-str")),
  );
});
Deno.test("O4 orderClose — HTTP errors mapped", () => expectHttpErrors(() => cn.orderClose("T-1")));
Deno.test("O4 orderClose — resilience", () => expectResilience(() => cn.orderClose("T-1")));

// ----------------------------------------------------------------
// S3 — Create Shop (POST /shop/create, JSON body)
// ----------------------------------------------------------------
Deno.test("S3 shopCreate — builds POST with JSON body", async () => {
  const body = { name: "Test Shop", address: "Epalinges" };
  await expectSuccess(
    () => cn.shopCreate(body),
    (c) => {
      assertEquals(c.init?.method, "POST");
      assert(c.url.includes("/shop/create"));
      assertEquals(JSON.parse(String(c.init?.body)), body);
      assert((c.init?.headers as Record<string, string>)["Content-Type"]?.includes("json"));
    },
  );
});
Deno.test("S3 shopCreate — HTTP errors mapped", () => expectHttpErrors(() => cn.shopCreate({})));
Deno.test("S3 shopCreate — resilience", () => expectResilience(() => cn.shopCreate({})));

// ----------------------------------------------------------------
// S4 — Update Shop (PUT /shop/update, JSON body) — idempotent
// ----------------------------------------------------------------
Deno.test("S4 shopUpdate — builds PUT with JSON body", async () => {
  const body = { id: "630bdd3b23", name: "Renamed" };
  await expectSuccess(
    () => cn.shopUpdate(body),
    (c) => {
      assertEquals(c.init?.method, "PUT");
      assert(c.url.includes("/shop/update"));
      assertEquals(JSON.parse(String(c.init?.body)), body);
    },
  );
});
Deno.test("S4 shopUpdate — HTTP errors mapped", () => expectHttpErrors(() => cn.shopUpdate({})));
Deno.test("S4 shopUpdate — resilience", () => expectResilience(() => cn.shopUpdate({})));

// ----------------------------------------------------------------
// S5 — Delete Shop (DELETE /shop/delete/{shopid}) — BLOCKED_BY_SAFETY
// ----------------------------------------------------------------
Deno.test("S5 shopDelete — builds DELETE with shopid in path (mock only)", async () => {
  await expectSuccess(
    () => cn.shopDelete("630bdd3b23"),
    (c) => {
      assertEquals(c.init?.method, "DELETE");
      assert(c.url.includes("/shop/delete/630bdd3b23"));
    },
  );
});
Deno.test("S5 shopDelete — HTTP errors mapped", () => expectHttpErrors(() => cn.shopDelete("x")));

// ----------------------------------------------------------------
// P3 — Save/Update Price Strategy (POST /shop/priceStrategy/saveOrUpdate)
// ----------------------------------------------------------------
Deno.test("P3 priceStrategySave — builds POST with strategy body", async () => {
  const body = { name: "Std", price: 100, priceTime: 60, priceUnit: 1 };
  await expectSuccess(
    () => cn.priceStrategySave(body),
    (c) => {
      assertEquals(c.init?.method, "POST");
      assert(c.url.includes("/shop/priceStrategy/saveOrUpdate"));
      assertEquals(JSON.parse(String(c.init?.body)).name, "Std");
    },
  );
});
Deno.test("P3 priceStrategySave — HTTP errors mapped", () => expectHttpErrors(() => cn.priceStrategySave({ name: "x" })));
Deno.test("P3 priceStrategySave — resilience", () => expectResilience(() => cn.priceStrategySave({ name: "x" })));

// ----------------------------------------------------------------
// P4 — Delete Price Strategy (POST /shop/priceStrategy/delete, array body) — BLOCKED
// ----------------------------------------------------------------
Deno.test("P4 priceStrategyDelete — builds POST with priceIds array (mock only)", async () => {
  await expectSuccess(
    () => cn.priceStrategyDelete([11, 22]),
    (c) => {
      assertEquals(c.init?.method, "POST");
      assert(c.url.includes("/shop/priceStrategy/delete"));
      assertEquals(JSON.parse(String(c.init?.body)), [11, 22]);
    },
  );
});
Deno.test("P4 priceStrategyDelete — HTTP errors mapped", () => expectHttpErrors(() => cn.priceStrategyDelete([1])));

// ----------------------------------------------------------------
// P5 — Bind Price Strategy (POST /shop/priceStrategy/bindShop)
// ----------------------------------------------------------------
Deno.test("P5 priceStrategyBind — builds POST with shopId/priceId/customType", async () => {
  await expectSuccess(
    () => cn.priceStrategyBind({ shopId: "630bdd3b23", priceId: 7, customType: 0 }),
    (c) => {
      assertEquals(c.init?.method, "POST");
      assert(c.url.includes("/shop/priceStrategy/bindShop"));
      const b = JSON.parse(String(c.init?.body));
      assertEquals(b.shopId, "630bdd3b23");
      assertEquals(b.priceId, 7);
      assertEquals(b.customType, 0);
    },
  );
});
Deno.test("P5 priceStrategyBind — HTTP errors mapped", () => expectHttpErrors(() => cn.priceStrategyBind({ shopId: "s", priceId: 1 })));
Deno.test("P5 priceStrategyBind — resilience", () => expectResilience(() => cn.priceStrategyBind({ shopId: "s", priceId: 1 })));

// ----------------------------------------------------------------
// P6 — Unbind Price Strategy (POST /shop/priceStrategy/unbindShop)
// ----------------------------------------------------------------
Deno.test("P6 priceStrategyUnbind — builds POST with shopId/customType", async () => {
  await expectSuccess(
    () => cn.priceStrategyUnbind({ shopId: "630bdd3b23", customType: 0 }),
    (c) => {
      assertEquals(c.init?.method, "POST");
      assert(c.url.includes("/shop/priceStrategy/unbindShop"));
      assertEquals(JSON.parse(String(c.init?.body)).shopId, "630bdd3b23");
    },
  );
});
Deno.test("P6 priceStrategyUnbind — HTTP errors mapped", () => expectHttpErrors(() => cn.priceStrategyUnbind({ shopId: "s" })));
Deno.test("P6 priceStrategyUnbind — resilience", () => expectResilience(() => cn.priceStrategyUnbind({ shopId: "s" })));

// ----------------------------------------------------------------
// C1 — Cabinet Operation (POST /cabinet/operation) — BLOCKED_BY_SAFETY
// Physical effect: pop/eject/lock/restart. Contract-mock only.
// ----------------------------------------------------------------
Deno.test("C1 cabinetOperation — builds POST with operationType/slotNum (mock only)", async () => {
  await expectSuccess(
    () => cn.cabinetOperation({ cabinetid: "DTA21269", slotNum: 2, operationType: "pop", reason: "test" }),
    (c) => {
      assertEquals(c.init?.method, "POST");
      assert(c.url.includes("/cabinet/operation"));
      assert(c.url.includes("cabinetid=DTA21269"));
      assert(c.url.includes("operationType=pop"));
      assert(c.url.includes("slotNum=2"));
    },
  );
});
Deno.test("C1 cabinetOperation — HTTP errors mapped", () => expectHttpErrors(() => cn.cabinetOperation({ cabinetid: "DTA21269", operationType: "heartbeat" })));

// ----------------------------------------------------------------
// C2 — Eject By Repair (POST /cabinet/ejectByRepair) — BLOCKED_BY_SAFETY
// ----------------------------------------------------------------
Deno.test("C2 ejectByRepair — builds POST with cabinetid/slotNum (mock only)", async () => {
  await expectSuccess(
    () => cn.ejectByRepair("DTA21269", 1),
    (c) => {
      assertEquals(c.init?.method, "POST");
      assert(c.url.includes("/cabinet/ejectByRepair"));
      assert(c.url.includes("cabinetid=DTA21269"));
      assert(c.url.includes("slotNum=1"));
    },
  );
});
Deno.test("C2 ejectByRepair — HTTP errors mapped", () => expectHttpErrors(() => cn.ejectByRepair("DTA21269", 1)));

// ----------------------------------------------------------------
// C3 — Eject By Rent (POST /cabinet/ejectByRent) — BLOCKED_BY_SAFETY
// ----------------------------------------------------------------
Deno.test("C3 ejectByRent — builds POST with cabinetid/rentOrderId/slotNum (mock only)", async () => {
  await expectSuccess(
    () => cn.ejectByRent("DTA21269", 3, "ORD-1"),
    (c) => {
      assertEquals(c.init?.method, "POST");
      assert(c.url.includes("/cabinet/ejectByRent"));
      assert(c.url.includes("cabinetid=DTA21269"));
      assert(c.url.includes("rentOrderId=ORD-1"));
      assert(c.url.includes("slotNum=3"));
    },
  );
});
Deno.test("C3 ejectByRent — HTTP errors mapped", () => expectHttpErrors(() => cn.ejectByRent("DTA21269", 3, "ORD-1")));

// ----------------------------------------------------------------
// E1 — Event Push Config (POST /cabinet/eventPush/config) — BLOCKED_BY_SAFETY
// Reconfigures global push routing; mock only.
// ----------------------------------------------------------------
Deno.test("E1 eventPushConfig — builds POST with pushUrl + subscriptions body (mock only)", async () => {
  await expectSuccess(
    () => cn.eventPushConfig("https://cb.test/push", [{ event: "BATTERY_IN", enable: true }]),
    (c) => {
      assertEquals(c.init?.method, "POST");
      assert(c.url.includes("/cabinet/eventPush/config"));
      const b = JSON.parse(String(c.init?.body));
      assertEquals(b.pushUrl, "https://cb.test/push");
      assertEquals(b.eventSubscriptions[0].event, "BATTERY_IN");
    },
  );
});
Deno.test("E1 eventPushConfig — HTTP errors mapped", () => expectHttpErrors(() => cn.eventPushConfig("https://x", [])));
