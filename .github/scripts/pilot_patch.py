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
