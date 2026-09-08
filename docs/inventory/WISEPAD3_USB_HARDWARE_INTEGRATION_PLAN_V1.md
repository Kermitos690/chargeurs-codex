# WISEPAD 3 USB HARDWARE INTEGRATION PLAN v1

**Owner:** AGENT 7 — Chargeurs Inventory & Supply Chain  
**Status:** GATE 0 / physical-controller verification required before procurement  
**Date:** 2026-08-11  
**Station target:** Chargeurs.ch kiosk, existing right-side terminal recess  

## 1. État actuel

### Reader physically observed — CONFIRMÉ

User-provided photographs identify the actual reader as:

- Manufacturer/product: BBPOS WisePad 3
- Model: `WPC32`
- Manufacturer serial: `WPC328211052352`
- Reader/HW identifier: `WPC30SZZ-Z1-0AT`
- PCI firmware identifier shown: `WPC32.01-41048`
- Bootloader: `6.03.02.61`
- Configuration shown: `SZZZ_Prod_EU_W1_on_v23`
- Physical connector observed: USB-C
- Reader is visibly powering/charging while a USB-C cable is connected.

The PCI firmware-ID mapping documented by Stripe means `WPC32.01-41048` corresponds to firmware `4.01.00.48`. This is an evidence-based mapping, not a value printed verbatim as the combined Stripe software version.

Stripe's current WisePad 3 reference lists `4.01.05.00_Prod_EU_W1_on_v28_510001` as the current package for AT/BE/DE/IT/LU/NL/CH. Therefore the photographed unit is behind the current firmware/config package and must be allowed to complete Stripe-required updates before production qualification.

### Chargeurs Android kiosk — CONFIRMÉ

Repository evidence confirms:

- native Android kiosk app exists under `android-kiosk/`;
- current application is a native Android shell hosting the Chargeurs WebView;
- Android manifest already declares `android.hardware.usb.host` with `required=false`;
- the hardware diagnostic collector already reads Android manufacturer/model/board/hardware and enumerates USB devices via `UsbManager`;
- current `android-kiosk/app/build.gradle.kts` contains no Stripe Terminal Android SDK dependency;
- current deployed DTA21269 kiosk record reports Chargeurs kiosk app `1.0.15-staging`.

### Exact Android controller / tablet — INCONNU

Neither the repository nor the current staging `kiosk_devices` record stores the physical manufacturer/model or port topology of the DTA21269 Android controller. No `local_gateway_observations` hardware report has been received for DTA21269 in staging.

Therefore the following are NOT YET PROVEN:

- controller/tablet manufacturer and exact model;
- physical USB receptacle type(s);
- whether a free host-capable port exists;
- USB host/OTG capability of the physical port;
- whether the controller can remain externally powered while acting as USB host;
- VBUS current budget;
- internal cable path and required cable length.

## 2. Compatibilité WisePad 3

### Officially supported USB path — CONFIRMÉ

Stripe officially supports the BBPOS WisePad 3 over USB on Android. The supported path is:

`Android device running Stripe Terminal SDK -> USB 2.0 data+charge cable -> WisePad 3`

Stripe requires Android Terminal SDK 3.0.0 or later for USB WisePad 3 support. The cable must support both USB data and charging. The Android application must discover with USB discovery and connect with USB connection configuration; first attachment can require Android USB permission.

The WisePad 3 product sheet specifies:

- USB 2.0 via USB-C connector;
- USB 2.0 via pogo pins;
- internal 800 mAh / 3.7 V Li-poly battery;
- charging voltage 5.25 V ± 0.25 V;
- dimensions approx. 69.7 x 121.7 x 17.7 mm;
- approx. 130 g;
- charging temperature 0–40°C;
- operating temperature 0–45°C;
- two M2 mounting nuts explicitly intended for cable retention only, maximum depth 2.5 mm.

### Chargeurs current software path — NON COMPATIBLE AS-IS

The current Chargeurs Android kiosk does not include the Stripe Terminal Android SDK. The WebView/front-end alone cannot satisfy Stripe's documented USB path.

Physical USB connection may enumerate the reader, but payment operation over USB requires a native Android Stripe Terminal integration owned by the Stripe/payment domain.

## 3. Architecture USB recommandée

### RECOMMANDÉE — direct dedicated host port

```text
Android kiosk/controller running Stripe Terminal Android SDK
        |
        | dedicated USB host port
        v
USB 2.0 data + power cable, 0.5–1.0 m target
        |
        | internal protected route + strain relief
        v
BBPOS WisePad 3 WPC32 USB-C
```

Conditions:

1. physical Android controller is proven USB host-capable;
2. dedicated host port remains available while controller itself is powered;
3. port supplies stable 5 V-class VBUS within reader requirements;
4. cable enumerates WisePad reliably and maintains charge;
5. native Android Stripe Terminal integration is added by payment owner.

### ACCEPTABLE — powered USB 2.0 hub

```text
Android kiosk/controller (USB host)
        |
        v
Powered USB hub / powered OTG topology
        |                 |
        |                 +--> stable external DC supply
        v
USB 2.0 data+charge cable
        v
WisePad 3 USB-C
```

Use only if the controller is host-capable but its USB power budget or number of ports is insufficient. Exact hub cannot be selected until controller connector, OTG behavior and simultaneous-charge topology are physically verified.

### À ÉVITER

- long internal USB extensions;
- passive USB splitters/Y cables used to improvise host + charging;
- adapters chained in series;
- charge-only USB-C cables;
- unretained USB-C plug in a permanent public kiosk;
- cable routing against sharp sheet-metal edges or moving/ejector mechanisms;
- relying on the reader battery as normal operating power when permanent 5 V is available.

### NON COMPATIBLE

- connecting WisePad 3 only to the cabinet PCB/MCU or an arbitrary Linux/serial controller that does not run a supported Stripe Terminal SDK;
- iOS USB path for WisePad 3;
- WebView-only JavaScript expecting to talk directly to the USB reader;
- assuming Android version alone proves USB host hardware support.

## 4. Architecture électrique

Reader charging input is documented as 5.25 V ± 0.25 V, so nominal USB 5 V is within the published range. The product sheet does not state a required charging current; do not invent one.

### Baseline

- data and charging should share the supported USB 2.0 connection;
- separate WisePad charging supply is not required if the Android host topology provides stable VBUS;
- a powered hub becomes relevant only when the real controller cannot provide a suitable power budget or must share a port;
- do not connect two independent supplies to the reader USB-C port.

The Android host must remain powered independently. If its only power connector is also its only OTG/host connector, a compatible powered-host/charge-through topology must be demonstrated on that exact controller before installation.

## 5. Schéma de câblage

### Candidate A — controller has USB-A host

`Controller USB-A HOST -> USB-A male / USB-C male USB 2.0 data+charge cable -> WisePad 3 USB-C`

This is mechanically simple and currently preferred if the physical controller exposes a dedicated USB-A host receptacle.

### Candidate B — controller has dedicated USB-C host/data

`Controller USB-C HOST -> USB-C / USB-C USB 2.0+ data+power cable -> WisePad 3 USB-C`

Only after proving the controller's USB-C port actually enters host role and remains powered as required.

### Candidate C — single controller USB power/OTG connector

`Controller USB OTG -> controller-compatible powered OTG/hub -> WisePad 3 + controller power path`

This is conditional. Do not buy a generic hub before testing that exact Android controller's simultaneous host/charge implementation.

## 6. Intégration mécanique

Constraints accepted for Chargeurs.ch:

- retain existing right-side terminal recess and external station envelope;
- reader non-removable by customer;
- reader rotated approximately 45° left for visibility;
- original card slot remains physically accessible on reader's right side;
- no artificial top card slot;
- display, keypad and NFC sensing area remain accessible;
- USB-C exits into the station interior;
- replacement fascia remains within current recess dimensions.

### Cable routing recommendation

- route USB immediately behind the reader into the protected interior, away from card-entry path and NFC face;
- use a controlled bend radius with no hard fold directly at USB-C plug;
- install a first strain-relief point close to the reader, using the official M2 cable-retention provisions if the final bracket geometry is validated against Stripe mechanical design files;
- M2 engagement depth must not exceed 2.5 mm;
- install a second chassis retention point before the cable reaches the Android controller/hub;
- use grommet/edge protection at every metal pass-through;
- cable must be field-replaceable without dismantling the WisePad or cutting permanent wiring;
- keep reader reset access/serviceability in the maintenance design;
- provide ventilation and verify enclosure temperature because the reader charging range stops at 40°C and operating range is 45°C maximum.

## 7. BOM v1

**Status:** provisional classes only. No cable/hub SKU is approved before controller verification.

| Component | Function | Minimum specification | Qty/station | Cost | Criticality | Status |
|---|---|---|---:|---|---|---|
| BBPOS WisePad 3 WPC32 | Payment reader | observed unit, USB-C | 1 | existing hardware | Critical | CONFIRMED |
| USB cable | Data + reader charging | USB 2.0 or better, full data conductors, correct host connector -> USB-C, short, mechanically robust | 1 | TBD | Critical | TO VERIFY |
| Reader cable-retention bracket | Prevent USB-C pullout | compatible with WisePad M2 retention nuts, max thread depth 2.5 mm | 1 | TBD | Critical | DESIGN REQUIRED |
| M2 retention fasteners | Bracket attachment | exact length chosen so insertion depth <=2.5 mm | 2 | TBD | Critical | DESIGN REQUIRED |
| Chassis strain relief | Secondary retention | serviceable clamp/P-clip/cable saddle appropriate to cable OD | 1–2 | TBD | High | TO SELECT |
| Edge grommet / bushing | Protect cable through sheet/plastic edge | sized to actual pass-through and cable OD | as needed | TBD | High | TO SELECT |
| Powered USB hub/OTG adapter | Only if controller needs it | controller-proven host + simultaneous power topology, stable USB 2.0 data | 0 or 1 | TBD | Critical if used | CONDITIONAL |
| Hub DC supply | Hub/controller power | only to matched hub/controller specification | 0 or 1 | TBD | Critical if used | CONDITIONAL |
| Replacement right-side fascia/bracket | Retain reader at ~45° | preserves card slot, keypad, display, NFC and internal USB route | 1 | TBD | High | MECHANICAL DESIGN |

### Cable length

USB-IF compliance guidance allows materially longer USB-C Full-Speed cables, but this does not justify a long kiosk harness. Agent 7 production recommendation is:

- target: 0.5–1.0 m;
- preferred maximum for this kiosk: 1.0 m if geometry permits;
- 1.5 m only if physical routing requires it and all stability tests pass;
- avoid extensions and unnecessary adapters.

This is an engineering reliability recommendation, not a Stripe protocol limit.

## 8. Risques

### P0 blockers

1. Exact Android controller/port topology unknown.
2. USB host capability not physically demonstrated.
3. Current Chargeurs Android APK contains no Stripe Terminal Android SDK.
4. Simultaneous controller power + USB host behavior unknown.

### High risks

- reader USB software update required on first Terminal connection;
- reader must be >50% battery for required updates;
- Stripe reader can reboot/disconnect as part of normal lifecycle/update behavior, so application must recover;
- USB plug pullout/vibration in permanent installation;
- thermal rise inside closed recess;
- non-IP-rated reader in public environment;
- wrong cable that charges but does not carry data.

## 9. Protocole de tests

### Test A — alimentation
- Measure/observe stable reader charging with final cable/topology.
- No low-battery cycling or unexpected restart.

### Test B — détection USB
- Connect reader to the actual DTA Android controller.
- Run Chargeurs hardware diagnostic.
- Confirm a new `UsbDevice` appears with stable vendor/product IDs.
- Confirm Android USB host feature on physical hardware.
- Capture diagnostic before/after connection.

### Test C — stabilité
- Minimum multi-hour soak with screen activity, standby and charging.
- Log USB detach/attach, reader reboot, battery and Android process events.

### Test D — paiement
- Payment owner only.
- Stripe TEST mode.
- Validate USB discovery, location binding, required software update, collection, cancellation and recovery.

### Test E — redémarrage
- Full Android controller reboot with reader left attached.
- Verify USB permission/reconnection strategy and reader rediscovery.

### Test F — déconnexion/reconnexion
- Physically disconnect/reconnect USB.
- Verify fail-safe UI and automatic rediscovery/reconnect logic.

### Test G — charge
- Observe reader battery before/after multi-hour connected operation.
- Verify it does not progressively discharge under expected kiosk load.

### Test H — thermique
- Instrument the final closed recess.
- Test worst-case ambient + charging + transaction workload.
- Keep within published reader operating/charging temperature limits with margin.

### Test I — mécanique
- Pull/strain test at reader and chassis retention points.
- Vibration/manipulation test.
- Verify card insertion/removal, keypad, display and NFC usability.
- Verify cable replacement remains possible for maintenance.

## 10. Éléments restant à vérifier physiquement

The next evidence required is from the actual Android kiosk/controller, not more WisePad photos.

Preferred method: run the existing Chargeurs `Diagnostic matériel automatique DTA` and copy the JSON output. The existing collector already reports:

- manufacturer;
- brand;
- model;
- device/product/hardware/board;
- Android version/SDK;
- currently enumerated USB devices with VID/PID/interfaces/permission.

Additionally provide photographs of:

1. rear/side label of the Android tablet/controller showing manufacturer + exact model;
2. every accessible USB/power connector on that device;
3. cable currently powering that Android device;
4. interior view from Android controller to the right-side WisePad recess;
5. ruler/tape measurement of approximate internal routing distance;
6. power-supply label feeding the Android controller and any internal USB hub/board.

If possible, run the USB diagnostic once with WisePad unplugged and once with it connected using the same data-capable cable. This gives the strongest no-assumption proof of host enumeration.

## 11. CROSS-DOMAIN HANDOFF — STRIPE TERMINAL / PAYMENT OWNER

### Need identified
The physical reader and Stripe platform support USB, but Chargeurs' current Android kiosk APK does not contain the Stripe Terminal Android SDK. USB cannot become a payment transport by cable installation alone.

### Hardware concerned
- BBPOS WisePad 3 `WPC32`
- serial `WPC328211052352`
- USB-C / USB 2.0
- Android kiosk controller for DTA station

### Expected software behavior

- add supported Stripe Terminal Android SDK;
- provision connection-token flow according to existing Chargeurs payment architecture;
- discover reader with USB discovery;
- connect with USB connection configuration and Stripe Location ID;
- persist expected reader serial and reconnect on app start;
- handle USB permission, disconnect/reconnect, reader reboot and mandatory software updates;
- expose only safe status to WebView/Kiosk UI;
- preserve all existing payment/deposit/pricing/rental invariants.

### Integration gates

- Stripe TEST mode only until accepted;
- exact physical Android USB host proven first;
- reader software updated through supported Stripe flow;
- no payment logic change owned by Agent 7.

## Procurement gate

**NO USB cable, hub, OTG adapter, bracket fastener length, or power accessory is approved for production procurement yet.**

The WisePad 3 side of USB is proven. The remaining hardware blocker is the exact kiosk Android controller and its port/power topology; the software blocker is native Stripe Terminal USB integration.