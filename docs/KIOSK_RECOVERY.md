# Kiosk recovery

An active flow may not live only in React state. On boot, reload and WebView
recreation, the kiosk must obtain a server-authorised resume projection for its
paired device and station:

- payment pending: restore the same QR session if still valid;
- payment succeeded/ejecting: restore the selected slot and transaction state;
- ejected/active: show the delivery or rental state;
- incident: show the public reference and safe support message.

Current state-version polling prevents stale poll regressions once deployed,
but a secure `kiosk_resume_state` endpoint plus real reboot testing remains a
P1 prerequisite. This is not yet TABLET_TESTED.
