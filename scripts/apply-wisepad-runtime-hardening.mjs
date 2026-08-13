import fs from "node:fs";

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  return source.replace(from, to);
}

const runtimePath = "android-kiosk/app/src/main/java/ch/chargeurs/kiosk/StripeTerminalReaderRuntime.java";
let runtime = fs.readFileSync(runtimePath, "utf8");

runtime = replaceOnce(
  runtime,
  `import android.content.Context;\nimport android.content.SharedPreferences;`,
  `import android.Manifest;\nimport android.content.Context;\nimport android.content.SharedPreferences;\nimport android.content.pm.PackageManager;`,
  "android permission imports",
);

runtime = replaceOnce(
  runtime,
  `    private final AtomicBoolean discoveryRunning = new AtomicBoolean(false);\n    private final AtomicBoolean paymentRunning = new AtomicBoolean(false);`,
  `    private final AtomicBoolean discoveryRunning = new AtomicBoolean(false);\n    private final AtomicBoolean paymentRunning = new AtomicBoolean(false);\n    private final AtomicBoolean bindingBootstrapRunning = new AtomicBoolean(false);`,
  "bootstrap guard field",
);

runtime = replaceOnce(
  runtime,
  `    private volatile String stripeLocationId;\n    private volatile String expectedReaderId;`,
  `    private volatile String stripeLocationId;\n    private volatile String expectedReaderId;\n    // One-shot TEST ConnectionToken fetched only to obtain the server-owned\n    // location/reader binding before connectReader(). It is consumed by the\n    // Stripe SDK provider and is never persisted, logged or exposed to JS.\n    private volatile String prefetchedConnectionTokenSecret;`,
  "prefetched token field",
);

runtime = replaceOnce(
  runtime,
`        main.post(() -> {
            if (!ensureTerminalInitialized()) return;
            Reader connected = Terminal.getInstance().getConnectedReader();
            if (connected != null && readerMatchesBinding(connected)) {
                acceptConnectedReader(connected);
                return;
            }
            if (!discoveryRunning.get() && !paymentRunning.get()) startDiscovery();
        });`,
`        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            setError("STRIPE_FINE_LOCATION_PERMISSION_REQUIRED");
            return;
        }
        // Agent 2 owns the TEST Location/optional Reader binding. Fetch it
        // before discovery so USB presence can never be promoted to READY and
        // connectReader() is never attempted without the canonical binding.
        if (blankToNull(stripeLocationId) == null) {
            bootstrapConnectionBinding();
            return;
        }
        main.post(() -> {
            if (!ensureTerminalInitialized()) return;
            Reader connected = Terminal.getInstance().getConnectedReader();
            if (connected != null && readerMatchesBinding(connected)) {
                acceptConnectedReader(connected);
                return;
            }
            if (!discoveryRunning.get() && !paymentRunning.get()) startDiscovery();
        });`,
  "ensureStarted binding bootstrap",
);

runtime = replaceOnce(
  runtime,
`    private void startDiscovery() {
        if (!BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED || !usbPresent()) {
            readerState = usbPresent() ? "UNAVAILABLE" : "ABSENT";
            return;
        }
        if (!discoveryRunning.compareAndSet(false, true)) return;
        readerState = "DISCOVERING";
        safeErrorCode = null;
        DiscoveryConfiguration config = new DiscoveryConfiguration.UsbDiscoveryConfiguration(0, false);
        discoveryCancelable = Terminal.getInstance().discoverReaders(`,
`    private void startDiscovery() {
        if (!BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED || !usbPresent()) {
            readerState = usbPresent() ? "UNAVAILABLE" : "ABSENT";
            return;
        }
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            setError("STRIPE_FINE_LOCATION_PERMISSION_REQUIRED");
            return;
        }
        if (!discoveryRunning.compareAndSet(false, true)) return;
        readerState = "DISCOVERING";
        safeErrorCode = null;
        DiscoveryConfiguration config = new DiscoveryConfiguration.UsbDiscoveryConfiguration(0, false);
        discoveryCancelable = Terminal.getInstance().discoverReaders(`,
  "discovery permission gate",
);

runtime = replaceOnce(
  runtime,
`    private void connect(Reader reader) {
        if ("CONNECTING".equals(readerState) || "READY".equals(readerState)) return;
        String location = blankToNull(stripeLocationId);`,
`    private void connect(Reader reader) {
        if ("CONNECTING".equals(readerState) || "READY".equals(readerState)) return;
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            setError("STRIPE_FINE_LOCATION_PERMISSION_REQUIRED");
            return;
        }
        String location = blankToNull(stripeLocationId);`,
  "connect permission gate",
);

runtime = replaceOnce(
  runtime,
`    private final class BackendConnectionTokenProvider implements ConnectionTokenProvider {
        @Override
        public void fetchConnectionToken(ConnectionTokenCallback callback) {
            io.execute(() -> {
                try {
                    StripeTerminalBackendClient.ConnectionTokenResult result = backend.fetchConnectionToken();
                    stripeLocationId = blankToNull(result.locationId());
                    expectedReaderId = blankToNull(result.expectedReaderId());
                    callback.onSuccess(result.secret());
                } catch (Exception error) {
                    safeErrorCode = StripeTerminalBackendClient.safeCode(error.getMessage());
                    callback.onFailure(new ConnectionTokenException("Chargeurs Terminal token unavailable", error));
                }
            });
        }
    }`,
`    private void bootstrapConnectionBinding() {
        if (!bindingBootstrapRunning.compareAndSet(false, true)) return;
        readerState = "DISCOVERING";
        io.execute(() -> {
            try {
                StripeTerminalBackendClient.ConnectionTokenResult result = backend.fetchConnectionToken();
                String location = blankToNull(result.locationId());
                if (location == null) throw new IOException("TERMINAL_LOCATION_BINDING_REQUIRED");
                stripeLocationId = location;
                expectedReaderId = blankToNull(result.expectedReaderId());
                prefetchedConnectionTokenSecret = result.secret();
                safeErrorCode = null;
            } catch (Exception error) {
                prefetchedConnectionTokenSecret = null;
                setError(StripeTerminalBackendClient.safeCode(error.getMessage()));
            } finally {
                bindingBootstrapRunning.set(false);
            }
            if (blankToNull(stripeLocationId) != null) main.post(this::ensureStarted);
        });
    }

    private final class BackendConnectionTokenProvider implements ConnectionTokenProvider {
        @Override
        public void fetchConnectionToken(ConnectionTokenCallback callback) {
            String prefetched = prefetchedConnectionTokenSecret;
            if (prefetched != null && !prefetched.isBlank()) {
                prefetchedConnectionTokenSecret = null;
                callback.onSuccess(prefetched);
                return;
            }
            io.execute(() -> {
                try {
                    StripeTerminalBackendClient.ConnectionTokenResult result = backend.fetchConnectionToken();
                    stripeLocationId = blankToNull(result.locationId());
                    expectedReaderId = blankToNull(result.expectedReaderId());
                    callback.onSuccess(result.secret());
                } catch (Exception error) {
                    safeErrorCode = StripeTerminalBackendClient.safeCode(error.getMessage());
                    callback.onFailure(new ConnectionTokenException("Chargeurs Terminal token unavailable", error));
                }
            });
        }
    }`,
  "one-shot token provider",
);

fs.writeFileSync(runtimePath, runtime);

const activityPath = "android-kiosk/app/src/main/java/ch/chargeurs/kiosk/MainActivity.java";
let activity = fs.readFileSync(activityPath, "utf8");
activity = replaceOnce(
  activity,
  `import android.annotation.SuppressLint;\nimport android.app.Activity;`,
  `import android.Manifest;\nimport android.annotation.SuppressLint;\nimport android.app.Activity;`,
  "activity Manifest import",
);
activity = replaceOnce(
  activity,
  `import android.content.Intent;\nimport android.content.SharedPreferences;`,
  `import android.content.Intent;\nimport android.content.SharedPreferences;\nimport android.content.pm.PackageManager;`,
  "activity PackageManager import",
);
activity = replaceOnce(
  activity,
  `    private static final String WEB_RUNTIME_VERSION = "last_runtime_version";`,
  `    private static final String WEB_RUNTIME_VERSION = "last_runtime_version";\n    private static final int STRIPE_TERMINAL_PERMISSION_REQUEST = 4701;`,
  "permission request constant",
);
activity = replaceOnce(
  activity,
`        KioskVisuals.applyKioskWindow(this);
        registerBackBlocking();
        setContentView(buildRoot());`,
`        KioskVisuals.applyKioskWindow(this);
        registerBackBlocking();
        setContentView(buildRoot());
        requestStripeTerminalPermissionIfNeeded();`,
  "boot permission request",
);
activity = replaceOnce(
  activity,
`    private FrameLayout buildRoot() {`,
`    private void requestStripeTerminalPermissionIfNeeded() {
        if (!BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED) return;
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, STRIPE_TERMINAL_PERMISSION_REQUEST);
    }

    private FrameLayout buildRoot() {`,
  "permission helper",
);
fs.writeFileSync(activityPath, activity);

console.log("Applied WisePad runtime permission + server binding/token bootstrap hardening");
