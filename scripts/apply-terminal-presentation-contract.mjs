import fs from "node:fs";

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(from, to);
}

const componentPath = "src/components/kiosk/KioskPaymentRailStage.tsx";
let component = fs.readFileSync(componentPath, "utf8");
component = replaceOnce(
  component,
`    const response = parseProjection(native.startTerminalPayment(rentalSessionId));
    try {
      const raw = native.startTerminalPayment;
      void raw;
    } catch { /* type guard only */ }
    // startTerminalPayment returns an acknowledgement, not a reader projection.
    let accepted = false;
    try {
      const ack = JSON.parse((native as NativeTerminalBridge).startTerminalPayment!(rentalSessionId)) as { ok?: boolean; code?: string };
`,
`    // startTerminalPayment returns one secret-free acknowledgement. The local
    // rail is locked before this call so a fast second tap cannot start QR.
    let accepted = false;
    try {
      const ack = JSON.parse(native.startTerminalPayment(rentalSessionId)) as { ok?: boolean; code?: string };
`,
  "single native Terminal start",
);
component = replaceOnce(component, `    onTerminalEngaged();\n    void response;\n`, `    onTerminalEngaged();\n`, "remove duplicate response marker");
fs.writeFileSync(componentPath, component);

const kioskPath = "src/pages/Kiosk.tsx";
let kiosk = fs.readFileSync(kioskPath, "utf8");
kiosk = replaceOnce(
  kiosk,
`import { KioskPaymentMarks } from "@/components/kiosk/KioskPaymentMarks";\n`,
`import { KioskPaymentMarks } from "@/components/kiosk/KioskPaymentMarks";\nimport { KioskPaymentRailStage } from "@/components/kiosk/KioskPaymentRailStage";\n`,
  "payment rail import",
);
kiosk = replaceOnce(
  kiosk,
`type Phase = "loading" | "idle" | "pricing" | "starting" | "qr" | "waitpay" | "success" | "error" | "support" | "expired";`,
`type Phase = "loading" | "idle" | "pricing" | "starting" | "payment_ready" | "terminal" | "qr" | "waitpay" | "success" | "error" | "support" | "expired";`,
  "phase contract",
);
kiosk = replaceOnce(
  kiosk,
`  const busy = ["starting", "qr", "waitpay", "success", "support"].includes(phase);`,
`  const busy = ["starting", "payment_ready", "terminal", "qr", "waitpay", "success", "support"].includes(phase);`,
  "busy states",
);
kiosk = replaceOnce(
  kiosk,
`    const protectedFlow = ["starting", "qr", "waitpay", "success", "support"].includes(phase);`,
`    const protectedFlow = ["starting", "payment_ready", "terminal", "qr", "waitpay", "success", "support"].includes(phase);`,
  "protected payment flow",
);
kiosk = replaceOnce(
  kiosk,
`    if (!sessionId || !publicCode || !["qr", "waitpay", "starting"].includes(phase)) return;`,
`    if (!sessionId || !publicCode || !["payment_ready", "terminal", "qr", "waitpay", "starting"].includes(phase)) return;`,
  "rental polling states",
);
kiosk = replaceOnce(
  kiosk,
`      const { data: sess, transportError: sessionTransportError } = await invokeKioskEdgeProxy<KioskFunctionResponse & {\n        session?: { id?: string };\n      }>("/api/kiosk/create-rental-session", { stationId, language: lang, selectedSlotNum: slotNum }, {`,
`      const { data: sess, transportError: sessionTransportError } = await invokeKioskEdgeProxy<KioskFunctionResponse & {\n        session?: { id?: string; public_session_code?: string | null; expires_at?: string | null };\n      }>("/api/kiosk/create-rental-session", { stationId, language: lang, selectedSlotNum: slotNum }, {`,
  "rental response type",
);
kiosk = replaceOnce(
  kiosk,
`      const sessionResponse = sess as (KioskFunctionResponse & { session?: { id?: string } }) | null;`,
`      const sessionResponse = sess as (KioskFunctionResponse & { session?: { id?: string; public_session_code?: string | null; expires_at?: string | null } }) | null;`,
  "rental response cast",
);
kiosk = replaceOnce(
  kiosk,
`      setSessionId(rentalSessionId);\n      await requestCheckout(rentalSessionId);`,
`      setSessionId(rentalSessionId);\n      setPublicCode(sessionResponse.session.public_session_code ?? null);\n      setExpiresAt(sessionResponse.session.expires_at ? new Date(sessionResponse.session.expires_at).getTime() : null);\n      setFlowFailure(null);\n      // #169 canonical boundary: rental + server quote now exist, but no rail\n      // has been claimed. The customer explicitly chooses Terminal or QR next.\n      setPhase("payment_ready");`,
  "PAYMENT_READY boundary",
);
kiosk = replaceOnce(
  kiosk,
`          {phase === "starting" && (\n            <motion.div key="starting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-6"><Loader2 className="h-20 w-20 animate-spin text-primary" /><p className="text-3xl font-bold text-muted-foreground">{t("kiosk.starting")}</p></motion.div>\n          )}\n\n          {phase === "qr" && checkoutUrl && (`,
`          {phase === "starting" && (\n            <motion.div key="starting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-6"><Loader2 className="h-20 w-20 animate-spin text-primary" /><p className="text-3xl font-bold text-muted-foreground">{t("kiosk.starting")}</p></motion.div>\n          )}\n\n          {phase === "payment_ready" && sessionId && (\n            <motion.div key="payment-ready" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex w-full justify-center">\n              <KioskPaymentRailStage\n                lang={lang}\n                rentalSessionId={sessionId}\n                stationId={stationId}\n                stationOnline={station?.online === true}\n                selectedSlot={slotNum ?? undefined}\n                pricingReady={Boolean(quote)}\n                pricingCurrency={quote?.currency}\n                onChooseQr={() => void requestCheckout(sessionId)}\n                onTerminalEngaged={() => setPhase("terminal")}\n                onServerConfirmed={() => setPhase("waitpay")}\n              />\n            </motion.div>\n          )}\n\n          {phase === "terminal" && sessionId && (\n            <motion.div key="terminal" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex w-full justify-center">\n              <KioskPaymentRailStage\n                lang={lang}\n                rentalSessionId={sessionId}\n                stationId={stationId}\n                stationOnline={station?.online === true}\n                selectedSlot={slotNum ?? undefined}\n                pricingReady={Boolean(quote)}\n                pricingCurrency={quote?.currency}\n                inProgress\n                onChooseQr={() => {}}\n                onTerminalEngaged={() => {}}\n                onServerConfirmed={() => setPhase("waitpay")}\n              />\n            </motion.div>\n          )}\n\n          {phase === "qr" && checkoutUrl && (`,
  "payment rail renderer",
);

fs.writeFileSync(kioskPath, kiosk);
console.log("Applied #169/#171 PAYMENT_READY + rail chooser convergence patch");
