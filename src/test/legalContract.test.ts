import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const kiosk = readFileSync(resolve(process.cwd(), "src/pages/Kiosk.tsx"), "utf8");
const mobile = readFileSync(resolve(process.cwd(), "src/pages/PaymentChoice.tsx"), "utf8");
const directCheckout = readFileSync(resolve(process.cwd(), "supabase/functions/create-stripe-checkout/index.ts"), "utf8");
const publicCheckout = readFileSync(resolve(process.cwd(), "supabase/functions/public-stripe-checkout/index.ts"), "utf8");
const terminal = readFileSync(resolve(process.cwd(), "supabase/functions/stripe-terminal-backend/index.ts"), "utf8");
const acceptance = readFileSync(resolve(process.cwd(), "supabase/functions/record-rental-contract-acceptance/index.ts"), "utf8");

describe("rental legal-contract acceptance", () => {
  it("starts unchecked and does not enable the kiosk payment choice before acceptance", () => {
    expect(kiosk).toContain("const [termsAccepted, setTermsAccepted] = useState(false)");
    expect(kiosk).toContain("disabled={!termsAccepted || legalSaving}");
    expect(kiosk).toContain("setPhase(\"payment_ready\")");
  });

  it("keeps legal access interactive and preserves the contract-review state when closed", () => {
    expect(kiosk).toContain("setLegalModalOpen(true)");
    expect(kiosk).toContain("setLegalModalOpen(false)");
    expect(kiosk).toContain("https://chargeurs.ch/legal/conditions");
    expect(kiosk).toContain("role=\"dialog\"");
  });

  it("uses canonical public legal routes and keeps mobile payment actions disabled before acceptance", () => {
    expect(mobile).toContain('href="/legal/conditions"');
    expect(mobile).toContain('href="/legal/confidentialite"');
    expect(mobile).toContain("disabled={!accepted || loading !== null}");
  });

  it("records server timestamps and blocks both QR and Terminal payment creation without acceptance", () => {
    expect(acceptance).toContain("contract_accepted_at: acceptedAt");
    expect(acceptance).toContain("surface, language");
    expect(directCheckout).toContain("CONTRACT_ACCEPTANCE_REQUIRED");
    expect(terminal).toContain("CONTRACT_ACCEPTANCE_REQUIRED");
    expect(publicCheckout.indexOf("contract_accepted_at: acceptedAt")).toBeLessThan(
      publicCheckout.indexOf("stripe.checkout.sessions.create"),
    );
  });
});
