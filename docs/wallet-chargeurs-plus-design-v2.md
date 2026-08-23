# Chargeurs+ Wallet — Design v2

Goal: remove all baked-in business text from image assets so Apple Wallet / Google Wallet native fields remain readable and dynamic.

## Principles

- Pass Studio remains presentation/distribution only.
- Chargeurs.ch backend remains the source of truth for plan, pricing, ChargePoints, membership state and rental state.
- No pricing, membership status, points, dates or marketing claims are baked into images.
- Do not use the wording `Pass membre premium` anywhere in Wallet assets.
- Keep the Loyalty pass type.

## Apple / Google visual assets

### Icon
Use only the Chargeurs battery/lightning mark on a dark navy square. No text.

Recommended source size: 261×261 px (3x quality; platform may resize).

### Logo
Use the Chargeurs battery/lightning mark only on a transparent background. Do not include `Chargeurs+`, `Chargeurs.ch`, `Pass membre premium`, tariff, or subtitle in the image. Apple Wallet already renders the organization name next to the logo area.

Recommended source size: 480×150 px, with the mark aligned left and large transparent padding to the right.

### Strip / banner
No text, no phone mockup, no pricing, no member label, no points, no card screenshot.

Recommended source size: 1125×369 px.

Visual direction:
- very dark navy base;
- restrained electric-cyan / blue energy glow;
- subtle battery/lightning geometry only at the extreme right edge;
- center and left side intentionally quiet/low-detail because Wallet overlays native fields there;
- high contrast against white Wallet text;
- no purple marketing block.

### Thumbnail
Optional. If kept, use only the Chargeurs battery/lightning symbol or a minimal powerbank/station silhouette. No wording.

Recommended source size: 270×270 px.

## Native Wallet data only

The following must remain native/dynamic fields, never artwork:

- member name;
- member number;
- plan/tier name;
- ChargePoints balance;
- current rental state;
- current rental cost;
- daily cap state;
- membership status;
- member hourly rate;
- daily cap;
- renewal credit;
- next renewal/end date;
- QR/barcode.

## Realtime tier display

Idle: `Client Chargeurs`

During rental, backend may replace the tier field with canonical realtime presentation states:

- `Location · CHF X.XX`
- `Plafond atteint · CHF X.XX`
- `Retour détecté`
- `Terminé · CHF X.XX`
- `Action requise`

## Notification architecture

- Per-holder `PATCH /instances/fields` remains the canonical automatic live update path.
- Pass Studio confirmed that the same endpoint accepts an optional `message` parameter for one specific `instanceId`.
- Apple Wallet shows that message as a native lock-screen banner and under `Latest update` on the pass back.
- Google Wallet sends a Wallet notification; Google caps visible notifications at 3 per pass/day, while later messages still remain inside the pass.
- Chargeurs.ch mirrors canonical customer notification events into `customer_wallet_native_notifications` and dispatches them asynchronously with retry/idempotency.
- Transactional rental alerts never use global Campaign audience segments.
- Campaigns remain appropriate for intentional broadcast/promotional messages.

## Visual acceptance gate

On a physical iPhone, the pass must show:

- no duplicated `Chargeurs+`/membership marketing text in artwork;
- no native field text overlapping the strip image;
- points, tier and member fields readable at a glance;
- QR unobstructed;
- Chargeurs branding still recognizable from the icon + color system alone.
