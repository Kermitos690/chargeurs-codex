from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    p.write_text(text.replace(old, new, 1))


# Stable selector for the single inactivity control owned by the inner Kiosk.
kiosk = Path("src/pages/Kiosk.tsx")
old_class = 'className="fixed left-5 top-[4.7rem] z-50 flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-2 text-sm font-bold shadow-lg backdrop-blur-xl sm:left-8 sm:top-[5.2rem]"'
new_class = 'className="kiosk-inactivity-control fixed left-5 top-[4.7rem] z-50 flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-2 text-sm font-bold shadow-lg backdrop-blur-xl sm:left-8 sm:top-[5.2rem]"'
text = kiosk.read_text()
if old_class in text:
    replace_once(str(kiosk), old_class, new_class)


# Pairing is still one-time, random and station/device-bound. Give a real user
# enough time to scan, read benefits and start the rental before consumption.
pairing = Path("supabase/functions/_shared/customerPairing.ts")
text = pairing.read_text()
if "CUSTOMER_PAIRING_TTL_SECONDS = 90;" in text:
    replace_once(str(pairing), "CUSTOMER_PAIRING_TTL_SECONDS = 90;", "CUSTOMER_PAIRING_TTL_SECONDS = 600;")


# ChargeNow's generic rentable flag is not allowed to override local repeated
# failure evidence. Overlay batteries.quarantine_reason before exposing slots.
snap = Path("supabase/functions/kiosk-cabinet-snapshot/index.ts")
src = snap.read_text()
anchor = "    const cabinetId = station.cabinet_id || station.station_id;\n    const snapshot = await readCabinetSnapshot(cabinetId);\n"
insert = """    const cabinetId = station.cabinet_id || station.station_id;\n    const snapshot = await readCabinetSnapshot(cabinetId);\n\n    const snapshotBatteryIds = snapshot.slots\n      .map((slot) => slot.battery_id)\n      .filter((value): value is string => Boolean(value));\n    const quarantinedBatteryIds = new Set<string>();\n    if (snapshotBatteryIds.length > 0) {\n      const { data: locallyBlocked, error: locallyBlockedError } = await db.from(\"batteries\")\n        .select(\"battery_id,quarantine_reason\")\n        .in(\"battery_id\", snapshotBatteryIds)\n        .not(\"quarantine_reason\", \"is\", null);\n      if (locallyBlockedError) throw locallyBlockedError;\n      for (const row of locallyBlocked ?? []) {\n        const batteryId = String(row.battery_id ?? \"\").trim();\n        const reason = String(row.quarantine_reason ?? \"\").trim();\n        if (batteryId && reason) quarantinedBatteryIds.add(batteryId);\n      }\n    }\n"""
if "const quarantinedBatteryIds = new Set<string>();" not in src:
    if src.count(anchor) != 1:
        raise SystemExit(f"{snap}: snapshot anchor mismatch")
    src = src.replace(anchor, insert, 1)

old_slots = """    const slots = snapshot.slots.map((slot) => ({\n      slot_num: slot.slot_num,\n      charge_percent: slot.customer_status === \"return_available\" ? null : slot.charge_percent,\n      rentable: slot.rentable,\n      confidence: slot.confidence,\n      status: slot.customer_status,\n      recommended: false,\n    }));\n\n    const candidates = snapshot.slots\n      .filter((slot) =>\n        slot.rentable\n"""
new_slots = """    const slots = snapshot.slots.map((slot) => {\n      const locallyQuarantined = Boolean(slot.battery_id && quarantinedBatteryIds.has(slot.battery_id));\n      return {\n        slot_num: slot.slot_num,\n        charge_percent: slot.customer_status === \"return_available\" ? null : slot.charge_percent,\n        rentable: slot.rentable && !locallyQuarantined,\n        confidence: slot.confidence,\n        status: locallyQuarantined ? \"technical_issue\" : slot.customer_status,\n        recommended: false,\n      };\n    });\n\n    const candidates = snapshot.slots\n      .filter((slot) =>\n        slot.rentable\n        && !(slot.battery_id && quarantinedBatteryIds.has(slot.battery_id))\n"""
if old_slots in src:
    src = src.replace(old_slots, new_slots, 1)
elif 'locallyQuarantined ? "technical_issue"' not in src:
    raise SystemExit(f"{snap}: slots anchor mismatch")
snap.write_text(src)


# The timeout-owner marker protects Stripe/release phases from the legacy outer
# timer, but it must not masquerade as a real physical release when Home is
# explicitly requested after a successful pre-payment cancellation.
gate = Path("src/pages/KioskPremiumGateV2.tsx")
gate_src = gate.read_text()
old_guard = '    if (document.querySelector(".kiosk-release-stage")) return;'
new_guard = '    if (document.querySelector(\'.kiosk-release-stage:not([data-kiosk-timeout-owner="inner"])\')) return;'
if old_guard in gate_src:
    gate_src = gate_src.replace(old_guard, new_guard, 1)

listener_anchor = """  }, [loadOptions]);\n\n  useEffect(() => {\n    document.documentElement.classList.add(\"kiosk-mode\");\n"""
listener_insert = """  }, [loadOptions]);\n\n  useEffect(() => {\n    const handleReturnHome = () => returnHome();\n    window.addEventListener(\"chargeurs:kiosk-return-home\", handleReturnHome);\n    return () => window.removeEventListener(\"chargeurs:kiosk-return-home\", handleReturnHome);\n  }, [returnHome]);\n\n  useEffect(() => {\n    document.documentElement.classList.add(\"kiosk-mode\");\n"""
if "chargeurs:kiosk-return-home" not in gate_src:
    if gate_src.count(listener_anchor) != 1:
        raise SystemExit(f"{gate}: return-home listener anchor mismatch")
    gate_src = gate_src.replace(listener_anchor, listener_insert, 1)
gate.write_text(gate_src)


# QR cancellation is server-confirmed: expire the real Stripe Checkout first,
# then ask the outer V3 gate to return to the three-choice home. No auto-home is
# reintroduced while a QR/payment/release phase is active.
kiosk_src = kiosk.read_text()
state_anchor = '  const [inactivitySeconds, setInactivitySeconds] = useState<number | null>(null);\n'
state_insert = state_anchor + '  const [cancellingCheckout, setCancellingCheckout] = useState(false);\n  const [cancelCheckoutError, setCancelCheckoutError] = useState<string | null>(null);\n'
if "const [cancellingCheckout" not in kiosk_src:
    if kiosk_src.count(state_anchor) != 1:
        raise SystemExit(f"{kiosk}: cancel state anchor mismatch")
    kiosk_src = kiosk_src.replace(state_anchor, state_insert, 1)

reset_anchor = """  const reset = useCallback(() => {\n    idemRef.current = null;\n    seenStateVersionRef.current = -1;\n    releaseFallbackAtRef.current = 0;\n    setPhase(\"idle\"); setCheckoutUrl(null); setSessionId(null);\n    setPublicCode(null); setExpiresAt(null); setSlotNum(null); setStatusMsg(null); setFlowFailure(null);\n    void refreshKioskData();\n  }, [refreshKioskData]);\n\n"""
cancel_callback = reset_anchor + """  const cancelCheckout = useCallback(async () => {\n    if (phase !== \"qr\" || !sessionId || !stationId || cancellingCheckout) return;\n    const token = readKioskToken();\n    if (!token) {\n      setCancelCheckoutError(\"KIOSK_AUTH_REQUIRED\");\n      return;\n    }\n    setCancellingCheckout(true);\n    setCancelCheckoutError(null);\n    const { data, transportError } = await invokeKioskEdgeProxy<KioskFunctionResponse>(\n      \"/api/kiosk/cancel-checkout\",\n      { rentalSessionId: sessionId },\n      { \"X-Kiosk-Token\": token },\n    );\n    if (transportError || !data?.ok) {\n      setCancelCheckoutError(data?.error ?? \"CHECKOUT_CANCEL_FAILED\");\n      setCancellingCheckout(false);\n      return;\n    }\n    setCancellingCheckout(false);\n    window.dispatchEvent(new CustomEvent(\"chargeurs:kiosk-return-home\"));\n  }, [phase, sessionId, stationId, cancellingCheckout]);\n\n"""
if "const cancelCheckout = useCallback" not in kiosk_src:
    if kiosk_src.count(reset_anchor) != 1:
        raise SystemExit(f"{kiosk}: cancel callback anchor mismatch")
    kiosk_src = kiosk_src.replace(reset_anchor, cancel_callback, 1)

old_button = """                <div className=\"mt-4 flex items-center gap-4\">{publicCode && <span className=\"font-mono text-xs text-muted-foreground\">{publicCode}</span>}<Button variant=\"ghost\" onClick={reset} className=\"h-12 gap-2 rounded-full px-6 text-lg\"><X className=\"h-5 w-5\" />{t(\"kiosk.cancel\")}</Button></div>\n"""
new_button = """                <div className=\"mt-4 flex flex-col items-center gap-2\">\n                  <div className=\"flex items-center gap-4\">{publicCode && <span className=\"font-mono text-xs text-muted-foreground\">{publicCode}</span>}<Button variant=\"ghost\" onClick={() => void cancelCheckout()} disabled={cancellingCheckout} className=\"h-12 gap-2 rounded-full px-6 text-lg\">{cancellingCheckout ? <Loader2 className=\"h-5 w-5 animate-spin\" /> : <X className=\"h-5 w-5\" />}{cancellingCheckout ? (lang === \"fr\" ? \"Annulation…\" : lang === \"de\" ? \"Abbruch…\" : \"Cancelling…\") : t(\"kiosk.cancel\")}</Button></div>\n                  {cancelCheckoutError && <span className=\"text-sm font-semibold text-warning\">{lang === \"fr\" ? \"Annulation impossible pour le moment. Réessayez.\" : lang === \"de\" ? \"Abbruch derzeit nicht möglich. Bitte erneut versuchen.\" : \"Unable to cancel right now. Please try again.\"}</span>}\n                </div>\n"""
if old_button in kiosk_src:
    kiosk_src = kiosk_src.replace(old_button, new_button, 1)
elif "void cancelCheckout()" not in kiosk_src:
    raise SystemExit(f"{kiosk}: QR cancel button anchor mismatch")
kiosk.write_text(kiosk_src)
