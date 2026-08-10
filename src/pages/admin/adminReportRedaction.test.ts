import { describe, expect, it } from "vitest";
import { redactAdminReportRows, redactAdminReportValue } from "./adminReportRedaction";

describe("admin test-report redaction", () => {
  it("removes credential and personal-data fields recursively", () => {
    expect(redactAdminReportValue({
      authorization: "Basic never-export-me",
      nested: { kioskToken: "never-export-me", email: "customer@example.test", tradeNo: "trade-owned-by-session" },
    })).toEqual({
      authorization: "[REDACTED]",
      nested: { kioskToken: "[REDACTED]", email: "[REDACTED]", tradeNo: "trade-owned-by-session" },
    });
  });

  it("keeps rows structurally useful while bounding oversized values", () => {
    const result = redactAdminReportRows([{ endpoint: "checkout", request: { rentalSessionId: "rental-1" }, message: "x".repeat(600) }]) as Array<Record<string, unknown>>;
    expect(result[0].endpoint).toBe("checkout");
    expect((result[0].message as string).endsWith("…[TRUNCATED]")).toBe(true);
  });
});
