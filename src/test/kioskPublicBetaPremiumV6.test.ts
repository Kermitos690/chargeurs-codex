import fs from "node:fs";
import { describe, expect, it } from "vitest";

const paymentSource = fs.readFileSync("src/components/kiosk/KioskPaymentRailStage.tsx", "utf8");
const diagnosticsSource = fs.readFileSync("src/components/kiosk/KioskDiagnostics.tsx", "utf8");
const premiumGateSource = fs.readFileSync("src/pages/KioskPremiumGateV3.tsx", "utf8");
const v6Css = fs.readFileSync("src/pages/kiosk-public-beta-premium-v6.css", "utf8");
const v6FinalCss = fs.readFileSync("src/pages/kiosk-public-beta-premium-v6-final.css", "utf8");
const powerbankSource = fs.readFileSync("src/components/kiosk/PowerbankScene.tsx", "utf8");

describe("Chargeurs kiosk public beta premium V6", () => {
  it("loads the V6 physical presentation after every legacy/canonical skin", () => {
    const v5Canvas = premiumGateSource.indexOf('import "./kiosk-home-reference-v5-canvas.css"');
    const v6 = premiumGateSource.indexOf('import "./kiosk-public-beta-premium-v6.css"');
    const finalFix = premiumGateSource.indexOf('import "./kiosk-public-beta-premium-v6-final.css"');

    expect(v5Canvas).toBeGreaterThan(0);
    expect(v6).toBeGreaterThan(v5Canvas);
    expect(finalFix).toBeGreaterThan(v6);
    expect(premiumGateSource).toContain('dataset.kioskVersion = "v6-public-beta-premium"');
  });

  it("does not expose raw reader/payment state combinations to customers", () => {
    expect(paymentSource).not.toContain('`${model.reader.state} · ${model.payment.railState}`');
    expect(paymentSource).not.toContain('"SERVER CONFIRMED"');
    expect(paymentSource).not.toContain("safeMessageCode ??");
    expect(paymentSource).toContain('processing: "Présentez votre carte"');
    expect(paymentSource).toContain('terminalLocation: "TERMINAL SOUS L’ÉCRAN"');
    expect(paymentSource).toContain("humanReaderStatus");
  });

  it("keeps payment callbacks and the canonical presentation model intact", () => {
    expect(paymentSource).toContain("buildChargeursPresentationModel");
    expect(paymentSource).toContain("native.startTerminalPayment(rentalSessionId)");
    expect(paymentSource).toContain("onTerminalEngaged()");
    expect(paymentSource).toContain("onServerConfirmed()");
    expect(paymentSource).toContain("onChooseQr()");
  });

  it("makes diagnostics an operator health surface and keeps credentials masked", () => {
    expect(diagnosticsSource).toContain("BORNE OPÉRATIONNELLE");
    expect(diagnosticsSource).toContain("Prêt pour un parcours client ?");
    expect(diagnosticsSource).toContain("DIAGNOSTIC AVANCÉ");
    expect(diagnosticsSource).toContain('return `présent (${t.length} car.)`');
    expect(diagnosticsSource).not.toContain("t.slice(");
  });

  it("provides a physical 1280x720 selection/payment hierarchy", () => {
    expect(v6Css).toContain("SELECTION — a product selection experience");
    expect(v6Css).toContain("grid-template-columns: 330px minmax(0, 1fr)");
    expect(v6Css).toContain("PAYMENT — physical-first hierarchy");
    expect(v6Css).toContain("kiosk-payment-terminal-v6");
    expect(v6Css).toContain("kiosk-qr-stage");
  });

  it("marks return slots for one-label presentation and removes non-localized pseudo-copy", () => {
    expect(powerbankSource).toContain('kiosk-slot-visual--${visualState}');
    expect(v6Css).toContain("kiosk-slot-visual--return");
    expect(v6FinalCss).toContain(".kiosk-idle-cta::before");
    expect(v6FinalCss).toContain("content: none !important");
  });
});
