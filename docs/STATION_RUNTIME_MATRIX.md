# Chargeurs.ch — Station Runtime Matrix

Status date: **2026-08-29**
Runtime observation window: **2026-08-28 UTC**

This register separates database-reported station/device state from APK metadata
read directly on a tablet. Similar version labels are not provenance evidence.

## Canonical Android status

**No `CANONICAL_STAGING_APK` exists.**

The three known stations report three different application version labels.
Package name, `versionCode`, signer certificate and source commit must be read
from the installed package/artifact before any line can be declared canonical.

## Fleet summary

| Station | Operational status | Environment | Station mode | Kiosk URL | Frontend host | Installed application version label | Confidence |
|---|---|---|---|---|---|---|---|
| `DTA21269` | online; 4 rentable / 0 returnable / 4 total at observation | staging | pilot; qualification `read_only` | `https://chargeurs-ch-staging.vercel.app/kiosk/DTA21269` | Vercel | `1.0.35-terminal-v300-readiness-staging` | Runtime DB: HIGH; APK provenance: LOW |
| `DTA21277` | online; 4 rentable / 0 returnable / 4 total at observation | staging | non-pilot flag; qualification `disabled` | `https://chargeurs-ch-staging.vercel.app/kiosk/DTA21277` | Vercel | `1.0.58-terminal-sdk580-process-reconnect-staging` | Runtime DB: HIGH; APK provenance: LOW |
| `DTA22032` | station status `maintenance` while connectivity was online; 0 rentable / 0 returnable / 4 total | staging | non-pilot flag; qualification `disabled` | `https://chargeurs-ch-staging.vercel.app/kiosk/DTA22032?sw=off&refresh=20260825-touchshield` | Vercel | `1.0.33-terminal-v300-usb-staging` | Runtime DB: HIGH; APK provenance: LOW |

## Detailed provenance register

| Field | DTA21269 | DTA21277 | DTA22032 |
|---|---|---|---|
| Station ID | `DTA21269` | `DTA21277` | `DTA22032` |
| Tablet/model | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| Android package installed | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| Application label reported to staging | `1.0.35-terminal-v300-readiness-staging` | `1.0.58-terminal-sdk580-process-reconnect-staging` | `1.0.33-terminal-v300-usb-staging` |
| `versionName` read from APK/device | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| `versionCode` read from APK/device | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| Signer SHA-256 read from APK/device | `UNKNOWN` | `UNKNOWN`; a candidate staging fingerprint exists in a field branch but is not installed-package proof | `UNKNOWN` |
| Exact source commit | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| Exact source branch / PR | `UNKNOWN`; multiple V3/Terminal field branches exist | `UNKNOWN`; PR #301 is a textual/configuration match, not provenance proof | `UNKNOWN` |
| Enrollment URL | Supabase staging `kiosk-enroll` expected by current source; installed value `UNKNOWN` | Same | Same |
| Runtime WebView URL | Vercel URL from `stations.kiosk_url` | Vercel URL from `stations.kiosk_url` | Vercel URL from `stations.kiosk_url` |
| Backend Supabase | `xqepbqnaenoeyfjkjnzl` according to enrollment/runtime records | Same | Same |
| Stripe Terminal SDK installed | `UNKNOWN`; label suggests a V3 lineage but is not binary proof | `UNKNOWN`; PR #301 candidate uses 5.8.0 | `UNKNOWN`; label suggests a V3 lineage but is not binary proof |
| Stripe station binding | No binding row observed | TEST binding enabled; Stripe location present; reader ID absent | No binding row observed |
| Physical Stripe reader | `UNKNOWN` | Expected WisePad 3; exact reader binding `UNKNOWN` | `UNKNOWN` / QR-only assumption not accepted as fact |
| Reader mode | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| ChargeNow relation | Station/cabinet runtime record exists | Station/cabinet runtime record exists | Station/cabinet runtime record exists |
| Native ChargeNow bridge | `UNKNOWN` on installed binary | `UNKNOWN` on installed binary | `UNKNOWN` on installed binary |
| Hardware ejection enabled | `UNKNOWN` on installed binary; current `main` source defaults false | `UNKNOWN` on installed binary; PR #301 source defaults false | `UNKNOWN` on installed binary; current `main` source defaults false |
| Latest controlled physical test | `UNKNOWN` — no single evidence record links station, APK SHA, signer, source SHA and result | `UNKNOWN` | `UNKNOWN` |
| Qualification | `read_only` | `disabled` | `disabled` |
| Release readiness | `BLOCKED` | `BLOCKED` | `BLOCKED` |

## Concurrent source lines

| Line | Source configuration | Runtime origin | Relationship to field state | Disposition |
|---|---|---|---|---|
| `main` baseline | normal code 151 / label 1.0.51; Stripe Terminal 3.0.0 | Vercel | Does not match any reported installed label | Preserve as canonical mainline; not canonical APK |
| PR #301 / `fix/dta21269-terminal-sdk-5-7` | normal code 158 / label 1.0.58; Stripe Terminal 5.8.0 | Vercel | Textually matches DTA21277 label, but CI/artifact/signer provenance is missing | `EXTRACT/REWORK`; do not merge wholesale |
| PR #338 Cloudflare branch | normal code 152 / label 1.0.52; Stripe Terminal 3.0.0 | Cloudflare WebView | No station is authorized on Cloudflare | Experiment only |
| PR #341 | normal code 151 / label 1.0.51; Stripe Terminal 3.0.0 | Cloudflare WebView | Version/artifact naming is internally inconsistent; PR is not mergeable | Do not merge |
| DTA21277 Cloudflare line | code 159 / label 1.0.59; Stripe Terminal 5.8.0 | Cloudflare WebView | Not reported installed | Experiment only |
| DTA21277 v161 workflow | Workflow rewrites source metadata to code 161 / label 1.0.61 then performs an ADB update | Cloudflare WebView | Live device still reported 1.0.58 at observation | Mutative workflow; not a canonical release path |

## Evidence required to designate `CANONICAL_STAGING_APK`

For each station, collect without changing its configuration:

1. `adb shell dumpsys package` package name, `versionCode` and `versionName`.
2. The installed APK copied read-only and its file SHA-256.
3. `apksigner verify --print-certs` signer SHA-256.
4. An exact source commit reproducing the same metadata and behavior.
5. Build manifest: source SHA, Gradle/SDK versions, environment, URLs and flags.
6. Stripe Terminal SDK and reader-mode evidence.
7. Controlled field-test record linked to station, APK SHA and date.
8. Rollback artifact with the same signer and a valid upgrade/downgrade plan.

Until all eight are available, station source, signer and canonical status remain
`UNKNOWN`/`BLOCKED`.
