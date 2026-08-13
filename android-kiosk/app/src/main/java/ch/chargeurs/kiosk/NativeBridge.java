package ch.chargeurs.kiosk;

import android.webkit.JavascriptInterface;

public final class NativeBridge {
    private final MainActivity activity;
    private final KioskConfig config;
    private final String devicePublicId;
    private final CabinetController cabinetController;
    private final EjectionAuthorizationVerifier authorizationVerifier;
    private final CommandReplayStore replayStore;
    private final LocalAuditLog auditLog;
    private final StripeTerminalReaderRuntime terminalRuntime;
    private final StripeTerminalSimulatedRuntime simulatedRuntime;

    public NativeBridge(MainActivity activity, KioskConfig config, CabinetController cabinetController) {
        this.activity = activity;
        this.config = config;
        this.devicePublicId = DeviceIdentity.getOrCreate(activity);
        this.cabinetController = cabinetController;
        this.authorizationVerifier = new EjectionAuthorizationVerifier(
            config.stationId(),
            devicePublicId,
            BuildConfig.EJECTION_PUBLIC_KEY_BASE64
        );
        this.replayStore = new CommandReplayStore(activity);
        this.auditLog = new LocalAuditLog(activity);
        ChargeursKioskApplication application = (ChargeursKioskApplication) activity.getApplication();
        if (BuildConfig.STRIPE_TERMINAL_SIMULATED_TEST_ENABLED) {
            this.terminalRuntime = null;
            this.simulatedRuntime = application.simulatedTerminalRuntime(config);
            this.simulatedRuntime.ensureStarted();
        } else {
            this.simulatedRuntime = null;
            this.terminalRuntime = application.terminalRuntime(config);
            this.terminalRuntime.ensureStarted();
        }
    }

    @JavascriptInterface
    public String getDeviceStatus() {
        return JsonObjects.of(
            "appVersion", BuildConfig.VERSION_NAME,
            "deviceId", devicePublicId,
            "stationId", config.stationId(),
            "hardware", cabinetController.status(),
            "wisePad", WisePadUsbProbe.snapshot(activity),
            "stripeTerminalUsbTestEnabled", BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED,
            "stripeTerminalSimulatedTestEnabled", BuildConfig.STRIPE_TERMINAL_SIMULATED_TEST_ENABLED,
            "paymentReader", paymentReaderSnapshot(),
            "vendorCompatibility", VendorAppCompatibility.inspect(activity)
        ).toString();
    }

    @JavascriptInterface
    public String getStationBinding() {
        return JsonObjects.of(
            "stationId", config.stationId(),
            "deviceId", devicePublicId
        ).toString();
    }

    @JavascriptInterface
    public String getHardwareStatus() {
        return getHardwareIntegrationStatus();
    }

    /** Canonical, secret-free payment-reader projection for the shared UI. */
    @JavascriptInterface
    public String getPaymentReaderStatus() {
        ensurePaymentReaderStarted();
        refreshPaymentReaderState(false);
        return paymentReaderSnapshot().toString();
    }

    /** Requests a fresh TEST discovery/connect attempt without touching vendor USB ownership. */
    @JavascriptInterface
    public String refreshPaymentReader() {
        ensurePaymentReaderStarted();
        return paymentReaderSnapshot().toString();
    }

    /** Starts the canonical Terminal rail for an already-created rental. */
    @JavascriptInterface
    public String startTerminalPayment(String rentalSessionId) {
        if (simulatedRuntime != null) {
            return simulatedRuntime.startTerminalPayment(rentalSessionId).toString();
        }
        return terminalRuntime.startTerminalPayment(rentalSessionId).toString();
    }

    /** Metadata-only provider compatibility state for hidden diagnostics. */
    @JavascriptInterface
    public String getHardwareIntegrationStatus() {
        return JsonObjects.of(
            "cabinet", cabinetController.status(),
            "wisePad", WisePadUsbProbe.snapshot(activity),
            "paymentReader", paymentReaderSnapshot(),
            "stripeTerminalUsbTestEnabled", BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED,
            "stripeTerminalSimulatedTestEnabled", BuildConfig.STRIPE_TERMINAL_SIMULATED_TEST_ENABLED,
            "vendorCompatibility", VendorAppCompatibility.inspect(activity),
            "physicalEjectionEnabled", isPhysicalEjectionEnabled()
        ).toString();
    }

    @JavascriptInterface
    public String getAppVersion() {
        return BuildConfig.VERSION_NAME;
    }

    @JavascriptInterface
    public void kioskUiReady() {
        activity.markKioskUiReady();
    }

    @JavascriptInterface
    public void openDiagnostics() {
        activity.showNativeDiagnostics(cabinetController.status());
    }

    @JavascriptInterface
    public void restartApp() {
        activity.restartKioskRuntime();
    }

    @JavascriptInterface
    public String requestLocalEjection(String signedAuthorization) {
        if (!isPhysicalEjectionEnabled()) {
            auditLog.record("ejection.disabled", JsonObjects.of("environment", BuildConfig.BUILD_ENVIRONMENT));
            return error("HARDWARE_EJECTION_DISABLED");
        }
        EjectionAuthorization authorization = null;
        try {
            authorization = authorizationVerifier.verify(signedAuthorization);
            if (!replayStore.claim(authorization.commandId(), authorization.expiresAtSeconds())) {
                auditLog.record("ejection.replay_rejected", JsonObjects.of("commandId", authorization.commandId()));
                return error("AUTHORIZATION_REPLAYED");
            }
            HardwareCommandResult result = cabinetController.eject(authorization);
            auditLog.record("ejection.result", result.json());
            return result.json().toString();
        } catch (Exception exception) {
            auditLog.record("ejection.authorization_rejected", JsonObjects.of("code", safeCode(exception)));
            return error(safeCode(exception));
        }
    }

    static boolean isPhysicalEjectionEnabled() {
        return BuildConfig.HARDWARE_EJECTION_ENABLED;
    }

    private void ensurePaymentReaderStarted() {
        if (simulatedRuntime != null) simulatedRuntime.ensureStarted();
        else terminalRuntime.ensureStarted();
    }

    private void refreshPaymentReaderState(boolean reconcile) {
        if (simulatedRuntime != null) simulatedRuntime.refreshPaymentState(reconcile);
        else terminalRuntime.refreshPaymentState(reconcile);
    }

    private org.json.JSONObject paymentReaderSnapshot() {
        return simulatedRuntime != null ? simulatedRuntime.snapshot() : terminalRuntime.snapshot();
    }

    private static String error(String code) {
        return JsonObjects.of("ok", false, "code", code).toString();
    }

    private static String safeCode(Exception exception) {
        String message = exception.getMessage();
        if (message != null && message.matches("^[A-Z0-9_]{3,80}$")) return message;
        return "EJECTION_AUTHORIZATION_REJECTED";
    }
}
