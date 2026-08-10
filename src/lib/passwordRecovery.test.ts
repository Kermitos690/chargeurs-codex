import { describe, expect, it } from "vitest";
import { recoveryLinkErrorMessage } from "./passwordRecovery";

describe("recoveryLinkErrorMessage", () => {
  it("explains a legacy PKCE recovery link without exposing a provider error", () => {
    expect(recoveryLinkErrorMessage("PKCE code verifier not found in storage.")).toContain(
      "autre navigateur",
    );
    expect(recoveryLinkErrorMessage("PKCE code verifier not found in storage.")).not.toContain(
      "not found",
    );
  });

  it("keeps other failures generic", () => {
    expect(recoveryLinkErrorMessage("expired")).toContain("invalide, expiré");
  });
});
