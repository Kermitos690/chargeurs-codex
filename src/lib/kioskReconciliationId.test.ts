import { describe, expect, it } from "vitest";
import { legacyReconciliationUuid } from "./kioskReconciliationId";

describe("legacyReconciliationUuid", () => {
  it("creates the PostgreSQL-compatible 37-char form required by staging v9", () => {
    expect(legacyReconciliationUuid("caf56227-5b44-43ff-93dc-a87f68705248"))
      .toBe("caf56227-5b44-43ff-93dc-a87f-68705248");
  });

  it("does not transform malformed or already padded ids", () => {
    expect(legacyReconciliationUuid("caf56227-5b44-43ff-93dc-a87f6870524")).toBeNull();
    expect(legacyReconciliationUuid("caf56227-5b44-43ff-93dc-a87f-68705248")).toBeNull();
    expect(legacyReconciliationUuid("not-a-uuid")).toBeNull();
  });
});
