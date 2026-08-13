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
        this.terminalRuntime = application.terminalRuntime(config);
        this.terminalRuntime.ensureStarted();
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
            "paymentReader", terminalRuntime.snapshot(),
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

    /**
     * Canonical, secret-free payment-reader projection for the shared
     * ChargeursPresentationModel. USB presence is diagnostics only; READY is
     * emitted solely by the Stripe Terminal connection lifecycle.
     */
    @JavascriptInterface
    public String getPaymentReaderStatus() {
        terminalRuntime.ensureStarted();
        terminalRuntime.refreshPaymentState(false);
        return terminalRuntime.snapshot().toString();
    }

    /**
     * Requests a new canonical discovery/connect attempt. This never revokes,
     * force-stops, disables or uninstalls the supplier POS application.
     */
    @JavascriptInterface
    public String refreshPaymentReader() {
        terminalRuntime.ensureStarted();
        return terminalRuntime.snapshot().toString();
    }

    /**
     * Starts the Terminal rail for an already-created canonical rental. The
     * native runtime asks Agent 2's backend to atomically claim TERMINAL before
     * any Stripe PaymentIntent side effect. No token, client secret, amount or
     * payment credential crosses back into the WebView.
     */
    @JavascriptInterface
    public String startTerminalPayment(String rentalSessionId) {
        return terminalRuntime.startTerminalPayment(rentalSessionId).toString();
    }

    /**
     * Metadata-only provider compatibility state for the hidden diagnostics
     * view. It cannot see or take over another app's network/serial session.
     */
    @JavascriptInterface
    public String getHardwareIntegrationStatus() {
        return JsonObjects.of(
            "cabinet", cabinetController.status(),
            "wisePad", WisePadUsbProbe.snapshot(activity),
            "paymentReader", terminalRuntime.snapshot(),
            "stripeTerminalUsbTestEnabled", BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED,
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
        try {
            EjectionAuthorization authorization = authorizationVerifier.verify(signedAuthorization);
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

    private static String error(String code) {
        return JsonObjects.of("ok", false, "code", code).toString();
    }

    private static String safeCode(Exception exception) {
        String message = exception.getMessage();
        if (message != null && message.matches("^[A-Z0-9_]{3,80}$")) return message;
        return "EJECTION_AUTHORIZATION_REJECTED";
    }
}
