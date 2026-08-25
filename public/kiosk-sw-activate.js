// This runs in the updated service worker, never in the kiosk page.
// Activate the new cached app shell; clients are not force-reloaded.
self.skipWaiting();
