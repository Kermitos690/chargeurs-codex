/* Chargeurs+ transactional Web Push extension loaded by Workbox. */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Chargeurs+", body: event.data ? event.data.text() : "" };
  }

  const title = typeof payload.title === "string" && payload.title ? payload.title : "Chargeurs+";
  const body = typeof payload.body === "string" ? payload.body : "";
  const rawUrl = typeof payload.url === "string" ? payload.url : "/compte";
  const safeUrl = rawUrl.startsWith("/") ? rawUrl : "/compte";
  const tag = typeof payload.tag === "string" && payload.tag ? payload.tag : "chargeurs-plus";

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag,
    renotify: false,
    data: {
      url: safeUrl,
      type: typeof payload.type === "string" ? payload.type : "transactional",
    },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = event.notification?.data?.url;
  const path = typeof rawUrl === "string" && rawUrl.startsWith("/") ? rawUrl : "/compte";
  const target = new URL(path, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      try {
        const current = new URL(client.url);
        if (current.origin !== self.location.origin) continue;
        if ("navigate" in client && client.url !== target) await client.navigate(target);
        if ("focus" in client) return client.focus();
      } catch {
        // Ignore a stale client and continue looking for a valid Chargeurs+ window.
      }
    }
    return self.clients.openWindow(target);
  })());
});
