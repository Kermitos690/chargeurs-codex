import { describe, expect, it } from "vitest";
import { CUSTOMER_PASSWORD_MIN_LENGTH, signupNeedsEmailConfirmation } from "./customerAccount";

describe("customer account onboarding", () => {
  it("requires a production-grade password length in the UI", () => {
    expect(CUSTOMER_PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(12);
  });

  it("keeps a new customer out of the private account until email confirmation creates a session", () => {
    expect(signupNeedsEmailConfirmation(null)).toBe(true);
    expect(signupNeedsEmailConfirmation(undefined)).toBe(true);
    expect(signupNeedsEmailConfirmation({ access_token: "session" })).toBe(false);
  });
});
