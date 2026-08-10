(() => {
  if (!window.location.pathname.startsWith('/kiosk/')) return;

  const root = document.documentElement;
  const artwork = new Image();
  let settled = false;

  const finish = (state) => {
    if (settled) return;
    settled = true;
    root.dataset.kioskArtwork = state;
  };

  root.dataset.kioskArtwork = 'checking';

  const timeout = window.setTimeout(() => finish('missing'), 2500);
  artwork.onload = () => {
    window.clearTimeout(timeout);
    finish('ready');
  };
  artwork.onerror = () => {
    window.clearTimeout(timeout);
    finish('missing');
  };

  artwork.src = '/cinematic-home.jpg?v=20260810-photo-master-3';
})();
