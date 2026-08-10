(() => {
  if (!window.location.pathname.startsWith('/kiosk/')) return;

  const root = document.documentElement;
  const artworkUrl = '/cinematic-home.jpg?v=20260810-photo-master-3';
  let attempt = 0;
  let probeTimer = 0;

  const mark = (state) => {
    root.dataset.kioskArtwork = state;
  };

  const probe = () => {
    attempt += 1;
    const artwork = new Image();
    let completed = false;

    const finishAttempt = () => {
      if (completed) return false;
      completed = true;
      window.clearTimeout(probeTimer);
      return true;
    };

    artwork.onload = () => {
      // A late successful decode must always recover the photographic hero,
      // even if a previous timeout temporarily enabled the native fallback.
      finishAttempt();
      mark('ready');
    };

    artwork.onerror = () => {
      if (!finishAttempt()) return;
      if (attempt < 3) {
        mark('checking');
        window.setTimeout(probe, 1200);
      } else {
        mark('missing');
      }
    };

    probeTimer = window.setTimeout(() => {
      if (!finishAttempt()) return;
      // Do not permanently latch missing on a slow kiosk WebView. Enable the
      // fallback temporarily, then retry; any later successful load wins.
      mark('missing');
      if (attempt < 3) window.setTimeout(probe, 1200);
    }, 8000);

    artwork.decoding = 'async';
    artwork.src = artworkUrl;
  };

  mark('checking');
  probe();
})();
