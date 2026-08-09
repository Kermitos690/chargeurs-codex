# Kiosk recovery

An active payment / dispense flow must not live only in React state. On boot,
reload and WebView recreation, the kiosk must obtain a server-authorised resume
projection for its paired device and station.

## Server recovery — implemented and deployed on staging

`kiosk-resume-state` is now implemented on the RC branch and deployed to the
Supabase staging project.

Security / scope:

- authenticated with the station-bound `X-Kiosk-Token`;
- the kiosk device must be active, not revoked/expired and bound to the requested station;
- read-only: it never mutates a rental and never calls Stripe or ChargeNow;
- returns only a safe UI projection, not PaymentIntent/customer/provider secrets;
- searches only recent transactions for the exact kiosk device + station;
- never resurrects a long-running historical rental and blocks the station for the next customer.

Recoverable recent states:

- `created` / `payment_pending`: restore the same Checkout URL only while it is still valid;
- `payment_succeeded` / `ejecting`: restore the selected slot and continue server polling / read-only physical reconciliation;
- `needs_support`: restore the safe incident screen;
- `ejected` / `battery_taken`: restore the success screen only for a short post-release window.

The Vercel RC config includes the intended proxy route:

`/api/kiosk/resume-state` → Supabase `kiosk-resume-state`.

## Frontend / tablet proof still required

The current kiosk React component still initializes `sessionId` and
`publicCode` from in-memory state. It must call the resume endpoint on startup,
rehydrate those values, then reuse the existing monotone `kiosk_session_status`
polling path.

That UI wiring cannot be claimed deployed until the Chargeurs.ch repository is
connected to the correct Vercel project. GitHub currently reports deployments
to the unrelated `esim-telegram-bot` Vercel project.

After the correct web deployment, controlled tablet acceptance must prove:

1. reload during Checkout restores the same QR rather than creating a new rental;
2. WebView/app kill after payment restores preparation/reconciliation state;
3. Android reboot preserves pairing and returns to the correct station;
4. no reboot creates a second Checkout, second reservation, second financial action or second hardware command;
5. a completed/old rental is not resurrected for the next customer.

Status:

- server resume endpoint: **IMPLEMENTED + DEPLOYED_STAGING**;
- frontend startup wiring: **NOT YET DEPLOYED**;
- physical tablet reboot test: **NOT YET TABLET_TESTED**.
