import { describe, expect, it } from "vitest";
import { createKioskIdempotencyKey } from "@/lib/kioskIdempotency";

describe("kiosk idempotency key", () => {
  it("creates a UUIDv4 without relying on crypto.randomUUID", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(createKioskIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
