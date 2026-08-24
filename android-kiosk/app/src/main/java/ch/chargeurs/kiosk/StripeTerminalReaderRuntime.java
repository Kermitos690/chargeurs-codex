package ch.chargeurs.kiosk;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.stripe.stripeterminal.Terminal;
import com.stripe.stripeterminal.external.callable.Callback;
import com.stripe.stripeterminal.external.callable.Cancelable;
import com.stripe.stripeterminal.external.callable.ConnectionTokenCallback;
import com.stripe.stripeterminal.external.callable.ConnectionTokenProvider;
import com.stripe.stripeterminal.external.callable.DiscoveryListener;
import com.stripe.stripeterminal.external.callable.MobileReaderListener;
import com.stripe.stripeterminal.external.callable.OfflineListener;
import com.stripe.stripeterminal.external.callable.PaymentIntentCallback;
import com.stripe.stripeterminal.external.callable.ReaderCallback;
import com.stripe.stripeterminal.external.callable.TerminalListener;
import com.stripe.stripeterminal.external.models.BatteryStatus;
import com.stripe.stripeterminal.external.models.CollectPaymentIntentConfiguration;
import com.stripe.stripeterminal.external.models.ConfirmPaymentIntentConfiguration;
import com.stripe.stripeterminal.external.models.ConnectionConfiguration;
import com.stripe.stripeterminal.external.models.ConnectionStatus;
import com.stripe.stripeterminal.external.models.ConnectionTokenException;
import com.stripe.stripeterminal.external.models.DisconnectReason;
import com.stripe.stripeterminal.external.models.DiscoveryConfiguration;
import com.stripe.stripeterminal.external.models.OfflineStatus;
import com.stripe.stripeterminal.external.models.PaymentIntent;
import com.stripe.stripeterminal.external.models.PaymentStatus;
import com.stripe.stripeterminal.external.models.Reader;
import com.stripe.stripeterminal.external.models.ReaderDisplayMessage;
import com.stripe.stripeterminal.external.models.ReaderEvent;
import com.stripe.stripeterminal.external.models.ReaderInputOptions;
import com.stripe.stripeterminal.external.models.ReaderSoftwareUpdate;
import com.stripe.stripeterminal.external.models.TerminalException;
import com.stripe.stripeterminal.log.LogLevel;

import org.json.JSONObject;

import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * TEST-only Stripe Terminal 5.8.0 USB runtime for DTA21269.
 *
 * Scope is deliberately restricted to the WisePad lifecycle. Pricing, deposit,
 * capture/settlement and battery ejection remain owned by the existing backend
 * and kiosk layers. The runtime uses Stripe's v5 unified processPaymentIntent()
 * flow so card collection + confirmation have one cancelable operation.
 */
final class StripeTerminalReaderRuntime implements MobileReaderListener {
    private static final String TAG = "ChargeursStripe58";
    private static final String PREFS = "stripe_terminal_reader";
    private static final String LAST_READER_ID = "last_reader_id";
    static final String SDK_COMPAT = "5.8.0-test-only";

    private final Context context;
    private final KioskConfig config;
    private final StripeTerminalBackendClient backend;
    private final SharedPreferences preferences;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private final AtomicBoolean discoveryRunning = new AtomicBoolean(false);
    private final AtomicBoolean connectionRunning = new AtomicBoolean(false);
    private final AtomicBoolean paymentRunning = new AtomicBoolean(false);
    private final AtomicBoolean paymentCancellationRunning = new AtomicBoolean(false);
    private final AtomicBoolean bindingBootstrapRunning = new AtomicBoolean(false);
    private final AtomicInteger discoveryGeneration = new AtomicInteger(0);
    private final AtomicInteger paymentOperationGeneration = new AtomicInteger(0);

    private volatile String readerState = "UNAVAILABLE";
    private volatile String safeErrorCode;
    private volatile String stripeReaderId;
    private volatile String stripeReaderSerial;
    private volatile String discoveredReaderId;
    private volatile String discoveredReaderSerial;
    private volatile String stripeLocationId;
    private volatile String expectedReaderId;
    private volatile String prefetchedConnectionTokenSecret;

    private volatile String localPaymentState = "IDLE";
    private volatile String activeRentalSessionId;
    private volatile String activePaymentIntentId;
    private volatile String paymentRail = "NONE";
    private volatile String paymentRailState = "UNCLAIMED";
    private volatile boolean serverConfirmed;
    private volatile boolean recoveryRequired;
    private volatile boolean bindingMismatchBlocked;
    private volatile boolean offlineCredentialRepairRequired;
    private volatile String correlationId;

    private volatile boolean reconnectFailed;
    private volatile boolean firmwareUpdateInProgress;
    private volatile float firmwareUpdateProgress;
    private volatile boolean availableUpdatePresent;
    private volatile boolean readerRebootInProgress;
    private volatile String lastDisconnectReason;
    private volatile float readerBatteryLevel = -1f;
    private volatile String readerBatteryStatus;
    private volatile boolean readerCharging;
    private volatile boolean lowBatteryWarning;

    private Cancelable discoveryCancelable;
    private Cancelable paymentCancelable;
    private Cancelable reconnectCancelable;

    StripeTerminalReaderRuntime(Context context, KioskConfig config) {
        this.context = context.getApplicationContext();
        this.config = config;
        this.backend = new StripeTerminalBackendClient(config);
        this.preferences = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED) {
            readerState = readerTransportPresent() ? "DISCOVERING" : "ABSENT";
        }
    }

    boolean matchesStation(String stationId) {
        return stationId != null && stationId.equals(config.stationId());
    }

    void ensureStarted() {
        if (!BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED) {
            readerState = "UNAVAILABLE";
            return;
        }
        if (!readerTransportPresent()) {
            if (!paymentRunning.get() && !firmwareUpdateInProgress) readerState = "ABSENT";
            return;
        }
        if (bindingMismatchBlocked) {
            setError("TERMINAL_READER_BINDING_MISMATCH");
            return;
        }
        if (shouldHoldReaderForExplicitOfflineCacheRepair(offlineCredentialRepairRequired)) {
            setError("STRIPE_OFFLINE_CREDENTIAL_CACHE_REPAIR_REQUIRED");
            return;
        }
        if (!simulatedReaderEnabled()
            && context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            setError("STRIPE_FINE_LOCATION_PERMISSION_REQUIRED");
            return;
        }
        if (!simulatedReaderEnabled() && blankToNull(stripeLocationId) == null) {
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

            String sdkStatus = terminalConnectionStatusName();
            if (sdkOwnsConnectionTransition(sdkStatus)) {
                readerState = sdkStatus;
                return;
            }
            if (canStartUsbDiscovery(discoveryRunning.get(), connectionRunning.get(), paymentRunning.get())) {
                startDiscovery();
            }
        });
    }

    /** Explicit non-financial retry. Never fights an SDK-owned auto reconnect. */
    void requestReconnect() {
        if (!BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED) {
            readerState = "UNAVAILABLE";
            return;
        }
        if (!readerTransportPresent()) {
            readerState = "ABSENT";
            return;
        }
        if (paymentRunning.get() || firmwareUpdateInProgress || readerRebootInProgress) return;

        main.post(() -> {
            if (!ensureTerminalInitialized()) return;
            Reader connected = Terminal.getInstance().getConnectedReader();
            if (!offlineCredentialRepairRequired && connected != null && readerMatchesBinding(connected)) {
                acceptConnectedReader(connected);
                return;
            }

            String sdkStatus = terminalConnectionStatusName();
            if (!offlineCredentialRepairRequired && sdkOwnsConnectionTransition(sdkStatus)) {
                readerState = sdkStatus;
                return;
            }

            discoveryGeneration.incrementAndGet();
            cancelDiscoverySilently();
            discoveryRunning.set(false);
            connectionRunning.set(false);
            safeErrorCode = null;
            reconnectFailed = false;

            if (offlineCredentialRepairRequired) {
                cancelReconnectSilently();
                if (connected != null) {
                    disconnectForOfflineCredentialRepair();
                    return;
                }
                if (!clearCachedCredentialsForOfflineRepair()) return;
            }

            readerState = "DISCOVERING";
            main.postDelayed(this::ensureStarted, 250L);
        });
    }

    void requireOfflineCredentialCacheRepair() {
        offlineCredentialRepairRequired = true;
        main.post(() -> {
            discoveryGeneration.incrementAndGet();
            cancelDiscoverySilently();
            connectionRunning.set(false);
            discoveryRunning.set(false);
            safeErrorCode = "STRIPE_OFFLINE_CREDENTIAL_CACHE_REPAIR_REQUIRED";
            readerState = readerTransportPresent() ? "ERROR" : "ABSENT";
        });
    }

    JSONObject snapshot() {
        boolean present = readerTransportPresent();
        if (!BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED) readerState = "UNAVAILABLE";
        else if (!present && !paymentRunning.get() && !firmwareUpdateInProgress) readerState = "ABSENT";
        else if (present && "ABSENT".equals(readerState)) ensureStarted();

        JSONObject usb = WisePadUsbProbe.snapshot(context);
        boolean maintenance = firmwareUpdateInProgress || readerRebootInProgress;
        String capability = "READY".equals(readerState) && !maintenance && bindingValidated()
            ? "TERMINAL_AND_QR"
            : "QR_ONLY";
        return JsonObjects.of(
            "readerState", readerState,
            "capability", capability,
            "payment", JsonObjects.of(
                "rail", paymentRail,
                "railState", paymentRailState,
                "localProcessState", localPaymentState,
                "serverConfirmed", serverConfirmed,
                "recoveryRequired", recoveryRequired,
                "correlationId", correlationId == null ? JSONObject.NULL : correlationId
            ),
            "diagnostics", JsonObjects.of(
                "transport", simulatedReaderEnabled() ? "simulated" : "usb",
                "stripeSdk", SDK_COMPAT,
                "paymentApi", "processPaymentIntent",
                "compatibilityLane", true,
                "simulatedReader", simulatedReaderEnabled(),
                "usbPresent", usb.optBoolean("present", false),
                "usbPermission", usb.optBoolean("permission", false),
                "locationPermission", context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED,
                "sdkConnectionStatus", terminalConnectionStatusName(),
                "discoveryRunning", discoveryRunning.get(),
                "connectionRunning", connectionRunning.get(),
                "discoveryGeneration", discoveryGeneration.get(),
                "autoReconnect", true,
                "reconnectFailed", reconnectFailed,
                "firmwareUpdateInProgress", firmwareUpdateInProgress,
                "firmwareUpdateProgress", firmwareUpdateProgress,
                "availableUpdatePresent", availableUpdatePresent,
                "readerRebootInProgress", readerRebootInProgress,
                "lastDisconnectReason", nullableJson(lastDisconnectReason),
                "readerBatteryLevel", readerBatteryLevel,
                "readerBatteryStatus", nullableJson(readerBatteryStatus),
                "readerCharging", readerCharging,
                "lowBatteryWarning", lowBatteryWarning,
                "targetVid", "15a2",
                "targetPid", "0101",
                "stripeReaderId", nullableJson(stripeReaderId),
                "stripeReaderSerial", nullableJson(stripeReaderSerial),
                "discoveredReaderId", nullableJson(discoveredReaderId),
                "discoveredReaderSerial", nullableJson(discoveredReaderSerial),
                "stripeLocationId", nullableJson(stripeLocationId),
                "expectedReaderId", nullableJson(expectedReaderId),
                "errorCode", nullableJson(safeErrorCode)
            )
        );
    }

    JSONObject startTerminalPayment(String rentalSessionId) {
        if (rentalSessionId == null || !rentalSessionId.matches("^[0-9a-fA-F-]{36}$")) {
            return JsonObjects.of("ok", false, "code", "INVALID_RENTAL_SESSION");
        }
        if (recoveryRequired) {
            return JsonObjects.of("ok", false, "code", "PAYMENT_RECONCILIATION_REQUIRED");
        }
        if (firmwareUpdateInProgress || readerRebootInProgress) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_MAINTENANCE_IN_PROGRESS");
        }
        if (!"READY".equals(readerState) || !bindingValidated()) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_NOT_READY");
        }
        if (!paymentRunning.compareAndSet(false, true)) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_BUSY");
        }

        final int operationGeneration = paymentOperationGeneration.incrementAndGet();
        activeRentalSessionId = rentalSessionId;
        localPaymentState = "CLAIMING";
        paymentRail = "TERMINAL";
        paymentRailState = "CLAIMING";
        serverConfirmed = false;
        recoveryRequired = false;
        correlationId = null;
        safeErrorCode = null;
        readerState = "BUSY";

        io.execute(() -> {
            try {
                StripeTerminalBackendClient.PaymentIntentResult result = backend.createPaymentIntent(
                    rentalSessionId,
                    simulatedReaderEnabled()
                );
                if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                paymentRail = result.rail();
                paymentRailState = result.railState();
                correlationId = blankToNull(result.correlationId());
                if (!"TERMINAL".equals(result.rail())) throw new IOException("PAYMENT_RAIL_ALREADY_CLAIMED");
                activePaymentIntentId = result.paymentIntentId();
                if (blankToNull(result.locationId()) != null) stripeLocationId = result.locationId();
                if (blankToNull(result.expectedReaderId()) != null) expectedReaderId = result.expectedReaderId();
                localPaymentState = "RETRIEVING_INTENT";
                main.post(() -> retrieveAndProcess(result.clientSecret(), operationGeneration));
            } catch (Exception error) {
                if (isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) {
                    finishPaymentFailure(StripeTerminalBackendClient.safeCode(error.getMessage()));
                }
            }
        });
        return JsonObjects.of("ok", true, "accepted", true, "rail", "TERMINAL", "railState", "CLAIMING");
    }

    JSONObject cancelTerminalPayment() {
        String rental = activeRentalSessionId;
        if (rental == null || rental.isBlank()) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_PAYMENT_NOT_ACTIVE");
        }
        if (!paymentCancellationRunning.compareAndSet(false, true)) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_CANCEL_IN_PROGRESS");
        }

        // Invalidate every SDK callback from the old operation first. In v5.6+
        // Cancelable.onSuccess runs only after the operation failure callback,
        // so backend cancellation happens after local processing has stopped.
        paymentOperationGeneration.incrementAndGet();
        localPaymentState = "CANCELLING";
        paymentRail = "TERMINAL";
        paymentRailState = "CANCELLING";
        Cancelable operation = paymentCancelable;
        if (operation != null && !operation.isCompleted()) {
            operation.cancel(new Callback() {
                @Override public void onSuccess() {
                    paymentCancelable = null;
                    cancelTerminalIntentOnServer(rental);
                }

                @Override public void onFailure(TerminalException error) {
                    paymentCancelable = null;
                    safeErrorCode = safeTerminalCode(error);
                    // Backend is authoritative and will refuse cancellation if
                    // Stripe reports that a payment side effect may exist.
                    cancelTerminalIntentOnServer(rental);
                }
            });
        } else {
            paymentCancelable = null;
            cancelTerminalIntentOnServer(rental);
        }
        return JsonObjects.of("ok", true, "accepted", true, "rail", "TERMINAL", "railState", "CANCELLING");
    }

    JSONObject rebootPaymentReader() {
        if (paymentRunning.get() || paymentCancellationRunning.get()) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_PAYMENT_ACTIVE");
        }
        if (firmwareUpdateInProgress) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_UPDATE_IN_PROGRESS");
        }
        if (!isReaderConnected()) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_NOT_CONNECTED");
        }
        if (readerRebootInProgress) {
            return JsonObjects.of("ok", true, "accepted", true, "state", "REBOOTING");
        }

        readerRebootInProgress = true;
        reconnectFailed = false;
        readerState = "REBOOTING";
        try {
            Terminal.getInstance().rebootReader(new Callback() {
                @Override public void onSuccess() {
                    readerState = "RECONNECTING";
                }

                @Override public void onFailure(TerminalException error) {
                    readerRebootInProgress = false;
                    setError(safeTerminalCode(error));
                }
            });
            return JsonObjects.of("ok", true, "accepted", true, "state", "REBOOTING");
        } catch (RuntimeException error) {
            readerRebootInProgress = false;
            setError("STRIPE_READER_REBOOT_FAILED");
            return JsonObjects.of("ok", false, "code", "STRIPE_READER_REBOOT_FAILED");
        }
    }

    JSONObject installPaymentReaderUpdate() {
        if (paymentRunning.get() || paymentCancellationRunning.get()) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_PAYMENT_ACTIVE");
        }
        if (readerRebootInProgress) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_REBOOT_IN_PROGRESS");
        }
        if (!isReaderConnected()) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_NOT_CONNECTED");
        }
        if (!availableUpdatePresent && !firmwareUpdateInProgress) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_UPDATE_NOT_AVAILABLE");
        }
        if (firmwareUpdateInProgress) {
            return JsonObjects.of("ok", true, "accepted", true, "state", "UPDATING");
        }

        try {
            firmwareUpdateInProgress = true;
            firmwareUpdateProgress = 0f;
            readerState = "UPDATING";
            Terminal.getInstance().installAvailableUpdate();
            return JsonObjects.of("ok", true, "accepted", true, "state", "UPDATING");
        } catch (RuntimeException error) {
            firmwareUpdateInProgress = false;
            setError("STRIPE_READER_UPDATE_START_FAILED");
            return JsonObjects.of("ok", false, "code", "STRIPE_READER_UPDATE_START_FAILED");
        }
    }

    void refreshPaymentState(boolean reconcile) {
        String rental = activeRentalSessionId;
        if (rental == null || rental.isBlank()) return;
        final int operationGeneration = paymentOperationGeneration.get();
        io.execute(() -> {
            try {
                StripeTerminalBackendClient.PaymentStateResult state = backend.getPaymentState(rental, reconcile);
                if (!shouldApplyPaymentState(
                    operationGeneration,
                    paymentOperationGeneration.get(),
                    rental,
                    activeRentalSessionId
                )) return;
                paymentRail = state.rail();
                paymentRailState = state.railState();
                serverConfirmed = state.serverConfirmed();
                recoveryRequired = state.recoveryRequired();
                correlationId = blankToNull(state.correlationId());
                if (isBackendCancellationConfirmed(state)) resetAfterCancellation();
            } catch (IOException error) {
                safeErrorCode = StripeTerminalBackendClient.safeCode(error.getMessage());
            }
        });
    }

    boolean shouldReconcilePaymentState() {
        return "SDK_SUCCEEDED".equals(localPaymentState)
            && activeRentalSessionId != null
            && !activeRentalSessionId.isBlank();
    }

    static boolean simulatedReaderEnabledForBuild(boolean stagingBuild, boolean simulationFlag) {
        return stagingBuild && simulationFlag;
    }

    static boolean isCurrentPaymentOperation(int callbackGeneration, int activeGeneration) {
        return callbackGeneration == activeGeneration;
    }

    static boolean canStartUsbDiscovery(boolean discoveryRunning, boolean connectionRunning, boolean paymentRunning) {
        return !discoveryRunning && !connectionRunning && !paymentRunning;
    }

    static boolean sdkOwnsConnectionTransition(String status) {
        return "DISCOVERING".equals(status)
            || "CONNECTING".equals(status)
            || "RECONNECTING".equals(status);
    }

    static boolean canOverrideStuckConnectionForOfflineCacheRepair(
        boolean offlineCredentialRepairRequired,
        boolean paymentRunning
    ) {
        return offlineCredentialRepairRequired && !paymentRunning;
    }

    static boolean shouldHoldReaderForExplicitOfflineCacheRepair(boolean offlineCredentialRepairRequired) {
        return offlineCredentialRepairRequired;
    }

    static boolean shouldAutoReconnectReader(String readerState) {
        return !"ERROR".equals(readerState);
    }

    static boolean canClearCachedCredentialsForRepair(
        String readerState,
        boolean paymentRunning,
        String activeRentalSessionId,
        boolean readerConnected
    ) {
        return "ERROR".equals(readerState)
            && !paymentRunning
            && (activeRentalSessionId == null || activeRentalSessionId.isBlank())
            && !readerConnected;
    }

    static boolean shouldApplyPaymentState(
        int responseGeneration,
        int activeGeneration,
        String requestedRentalSessionId,
        String activeRentalSessionId
    ) {
        return responseGeneration == activeGeneration
            && requestedRentalSessionId != null
            && requestedRentalSessionId.equals(activeRentalSessionId);
    }

    static boolean isBackendCancellationConfirmed(StripeTerminalBackendClient.PaymentStateResult state) {
        return state != null
            && "NONE".equals(state.rail())
            && ("CANCELLED".equals(state.railState()) || "EXPIRED".equals(state.railState()))
            && !state.serverConfirmed()
            && !state.recoveryRequired();
    }

    private void retrieveAndProcess(String clientSecret, int operationGeneration) {
        if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
        if (!Terminal.isInitialized() || Terminal.getInstance().getConnectedReader() == null) {
            finishPaymentFailure("TERMINAL_DISCONNECTED");
            return;
        }

        Terminal.getInstance().retrievePaymentIntent(clientSecret, new PaymentIntentCallback() {
            @Override
            public void onSuccess(PaymentIntent paymentIntent) {
                if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                localPaymentState = "PROCESSING";
                paymentRailState = "PROCESSING";
                CollectPaymentIntentConfiguration collect = new CollectPaymentIntentConfiguration.Builder()
                    .skipTipping(true)
                    .build();
                ConfirmPaymentIntentConfiguration confirm = new ConfirmPaymentIntentConfiguration.Builder().build();
                paymentCancelable = Terminal.getInstance().processPaymentIntent(
                    paymentIntent,
                    collect,
                    confirm,
                    new PaymentIntentCallback() {
                        @Override
                        public void onSuccess(PaymentIntent processed) {
                            if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                            paymentCancelable = null;
                            activePaymentIntentId = processed.getId();
                            localPaymentState = "SDK_SUCCEEDED";
                            paymentRailState = "PROCESSING";
                            paymentRunning.set(false);
                            readerState = idleReaderState();
                            refreshPaymentState(true);
                        }

                        @Override
                        public void onFailure(TerminalException error) {
                            if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                            paymentCancelable = null;
                            if (isCancellation(error)) {
                                cancelAfterReaderStop();
                                return;
                            }
                            finishPaymentFailure(safeTerminalCode(error));
                            refreshPaymentState(true);
                        }
                    }
                );
            }

            @Override
            public void onFailure(TerminalException error) {
                if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                finishPaymentFailure(safeTerminalCode(error));
                refreshPaymentState(true);
            }
        });
    }

    private boolean ensureTerminalInitialized() {
        try {
            if (!Terminal.isInitialized()) {
                Terminal.init(
                    context,
                    LogLevel.ERROR,
                    new BackendConnectionTokenProvider(),
                    new RuntimeTerminalListener(),
                    new RuntimeOfflineListener()
                );
            }
            return true;
        } catch (Exception error) {
            Log.e(TAG, "Stripe Terminal 5.8.0 init failed", error);
            setError("STRIPE_TERMINAL_58_INIT_FAILED");
            return false;
        }
    }

    private void startDiscovery() {
        if (!BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED || !readerTransportPresent()) {
            readerState = readerTransportPresent() ? "UNAVAILABLE" : "ABSENT";
            return;
        }
        if (!simulatedReaderEnabled()
            && context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            setError("STRIPE_FINE_LOCATION_PERMISSION_REQUIRED");
            return;
        }
        if (!ensureTerminalInitialized()) return;
        Reader connected = Terminal.getInstance().getConnectedReader();
        if (connected != null && readerMatchesBinding(connected)) {
            acceptConnectedReader(connected);
            return;
        }
        String sdkStatus = terminalConnectionStatusName();
        if (sdkOwnsConnectionTransition(sdkStatus)) {
            readerState = sdkStatus;
            return;
        }
        if (connectionRunning.get() || !discoveryRunning.compareAndSet(false, true)) return;

        final int generation = discoveryGeneration.incrementAndGet();
        readerState = "DISCOVERING";
        safeErrorCode = null;
        reconnectFailed = false;
        discoveredReaderId = null;
        discoveredReaderSerial = null;
        Log.i(TAG, "USB discovery started with Stripe Terminal 5.8.0");

        DiscoveryConfiguration discoveryConfig = new DiscoveryConfiguration.UsbDiscoveryConfiguration(
            0,
            simulatedReaderEnabled()
        );
        discoveryCancelable = Terminal.getInstance().discoverReaders(
            discoveryConfig,
            new DiscoveryListener() {
                @Override
                public void onUpdateDiscoveredReaders(List<Reader> readers) {
                    if (generation != discoveryGeneration.get() || !discoveryRunning.get()) return;
                    if (readers != null && !readers.isEmpty()) {
                        Reader first = readers.get(0);
                        discoveredReaderId = first.getId();
                        discoveredReaderSerial = first.getSerialNumber();
                    }
                    Reader candidate = chooseReader(readers);
                    if (candidate != null) connect(candidate, generation);
                }
            },
            new Callback() {
                @Override
                public void onSuccess() {
                    if (generation != discoveryGeneration.get()) return;
                    discoveryCancelable = null;
                    discoveryRunning.set(false);
                    Reader current = Terminal.getInstance().getConnectedReader();
                    if (current != null && readerMatchesBinding(current)) {
                        acceptConnectedReader(current);
                    } else if (readerTransportPresent() && !connectionRunning.get()
                        && !sdkOwnsConnectionTransition(terminalConnectionStatusName())) {
                        setError("STRIPE_READER_NOT_DISCOVERED");
                    }
                }

                @Override
                public void onFailure(TerminalException error) {
                    if (generation != discoveryGeneration.get()) return;
                    discoveryCancelable = null;
                    discoveryRunning.set(false);
                    setError(safeTerminalCode(error));
                }
            }
        );
    }

    private Reader chooseReader(List<Reader> readers) {
        if (readers == null || readers.isEmpty()) return null;
        if (simulatedReaderEnabled()) return readers.get(0);

        String expected = blankToNull(expectedReaderId);
        String remembered = preferences.getString(LAST_READER_ID, null);
        if (expected != null) {
            for (Reader reader : readers) if (expected.equals(reader.getId())) return reader;
            if (readers.size() == 1 && blankToNull(readers.get(0).getId()) == null) return readers.get(0);
            return null;
        }
        if (remembered != null) {
            for (Reader reader : readers) {
                if (remembered.equals(reader.getId()) || remembered.equals(reader.getSerialNumber())) return reader;
            }
        }
        return readers.get(0);
    }

    private void connect(Reader reader, int generation) {
        if (generation != discoveryGeneration.get()) return;
        if ("READY".equals(readerState) || !connectionRunning.compareAndSet(false, true)) return;

        String location = simulatedReaderEnabled()
            ? (reader.getLocation() == null ? null : blankToNull(reader.getLocation().getId()))
            : blankToNull(stripeLocationId);
        if (location == null) {
            connectionRunning.set(false);
            setError("TERMINAL_LOCATION_BINDING_REQUIRED");
            return;
        }

        readerState = "CONNECTING";
        ConnectionConfiguration connectionConfig = new ConnectionConfiguration.UsbConnectionConfiguration(
            location,
            true,
            this
        );
        Terminal.getInstance().connectReader(
            reader,
            connectionConfig,
            new ReaderCallback() {
                @Override
                public void onSuccess(Reader connected) {
                    connectionRunning.set(false);
                    if (generation != discoveryGeneration.get()) return;
                    discoveryRunning.set(false);
                    cancelDiscoverySilently();
                    if (!readerMatchesBinding(connected)) {
                        bindingMismatchBlocked = true;
                        disconnectForBindingMismatch();
                        setError("TERMINAL_READER_BINDING_MISMATCH");
                        return;
                    }
                    acceptConnectedReader(connected);
                }

                @Override
                public void onFailure(TerminalException error) {
                    connectionRunning.set(false);
                    if (generation != discoveryGeneration.get()) return;
                    discoveryRunning.set(false);
                    setError(safeTerminalCode(error));
                }
            }
        );
    }

    private void acceptConnectedReader(Reader reader) {
        bindingMismatchBlocked = false;
        reconnectFailed = false;
        reconnectCancelable = null;
        readerRebootInProgress = false;
        stripeReaderId = reader.getId();
        stripeReaderSerial = reader.getSerialNumber();
        if (!simulatedReaderEnabled() && reader.getLocation() != null && reader.getLocation().getId() != null) {
            stripeLocationId = reader.getLocation().getId();
        }
        if (!simulatedReaderEnabled()) {
            if (blankToNull(stripeReaderId) != null) preferences.edit().putString(LAST_READER_ID, stripeReaderId).apply();
            else if (blankToNull(stripeReaderSerial) != null) preferences.edit().putString(LAST_READER_ID, stripeReaderSerial).apply();
        }
        connectionRunning.set(false);
        discoveryRunning.set(false);
        safeErrorCode = null;
        readerState = firmwareUpdateInProgress ? "UPDATING" : (paymentRunning.get() ? "BUSY" : "READY");
        Log.i(TAG, "WisePad USB connected through Stripe Terminal 5.8.0");
    }

    private boolean readerMatchesBinding(Reader reader) {
        if (reader == null) return false;
        if (simulatedReaderEnabled()) return true;
        String expected = blankToNull(expectedReaderId);
        if (expected != null && reader.getId() != null && !expected.equals(reader.getId())) return false;
        String expectedLocation = blankToNull(stripeLocationId);
        return expectedLocation == null
            || reader.getLocation() == null
            || reader.getLocation().getId() == null
            || expectedLocation.equals(reader.getLocation().getId());
    }

    private boolean bindingValidated() {
        if (!"READY".equals(readerState) || !Terminal.isInitialized()) return false;
        if (!simulatedReaderEnabled() && blankToNull(stripeLocationId) == null) return false;
        Reader connected = Terminal.getInstance().getConnectedReader();
        return connected != null && readerMatchesBinding(connected);
    }

    private void cancelAfterReaderStop() {
        String rental = activeRentalSessionId;
        if (rental == null || rental.isBlank()) return;
        if (!paymentCancellationRunning.compareAndSet(false, true)) return;
        paymentOperationGeneration.incrementAndGet();
        localPaymentState = "CANCELLING";
        paymentRail = "TERMINAL";
        paymentRailState = "CANCELLING";
        paymentCancelable = null;
        cancelTerminalIntentOnServer(rental);
    }

    private void cancelTerminalIntentOnServer(String rentalSessionId) {
        io.execute(() -> {
            try {
                StripeTerminalBackendClient.PaymentStateResult state = backend.cancelPaymentIntent(rentalSessionId);
                paymentRail = state.rail();
                paymentRailState = state.railState();
                serverConfirmed = state.serverConfirmed();
                recoveryRequired = state.recoveryRequired();
                correlationId = blankToNull(state.correlationId());
                if (isBackendCancellationConfirmed(state)) {
                    resetAfterCancellation();
                } else {
                    localPaymentState = "RECOVERY_REQUIRED";
                    recoveryRequired = true;
                    paymentRunning.set(false);
                    safeErrorCode = "PAYMENT_RECONCILIATION_REQUIRED";
                    readerState = idleReaderState();
                }
            } catch (IOException error) {
                localPaymentState = "RECOVERY_REQUIRED";
                recoveryRequired = true;
                paymentRunning.set(false);
                paymentRailState = "RECOVERY_REQUIRED";
                safeErrorCode = StripeTerminalBackendClient.safeCode(error.getMessage());
                readerState = idleReaderState();
            } finally {
                paymentCancellationRunning.set(false);
            }
        });
    }

    private void resetAfterCancellation() {
        localPaymentState = "CANCELLED";
        activePaymentIntentId = null;
        activeRentalSessionId = null;
        paymentCancelable = null;
        paymentRunning.set(false);
        recoveryRequired = false;
        safeErrorCode = null;
        readerState = idleReaderState();
    }

    private void disconnectForBindingMismatch() {
        try {
            Terminal.getInstance().disconnectReader(new Callback() {
                @Override public void onSuccess() { Log.w(TAG, "Disconnected mismatched WisePad"); }
                @Override public void onFailure(TerminalException error) {
                    Log.w(TAG, "Failed to disconnect mismatched WisePad: " + safeTerminalCode(error));
                }
            });
        } catch (RuntimeException error) {
            Log.w(TAG, "Failed to start mismatched WisePad disconnect", error);
        }
    }

    private void disconnectForOfflineCredentialRepair() {
        readerState = "RECONNECTING";
        try {
            Terminal.getInstance().disconnectReader(new Callback() {
                @Override public void onSuccess() {
                    if (!offlineCredentialRepairRequired) return;
                    if (!clearCachedCredentialsForOfflineRepair()) return;
                    main.postDelayed(StripeTerminalReaderRuntime.this::ensureStarted, 250L);
                }

                @Override public void onFailure(TerminalException error) {
                    setError("STRIPE_CREDENTIAL_REPAIR_DISCONNECT_FAILED");
                }
            });
        } catch (RuntimeException error) {
            setError("STRIPE_CREDENTIAL_REPAIR_DISCONNECT_FAILED");
        }
    }

    private boolean clearCachedCredentialsForOfflineRepair() {
        if (!canClearCachedCredentialsForRepair(
            "ERROR",
            paymentRunning.get(),
            activeRentalSessionId,
            isReaderConnected()
        )) {
            setError("STRIPE_CREDENTIAL_REPAIR_NOT_SAFE");
            return false;
        }
        try {
            Terminal.getInstance().clearCachedCredentials();
            prefetchedConnectionTokenSecret = null;
            offlineCredentialRepairRequired = false;
            safeErrorCode = null;
            return true;
        } catch (Exception error) {
            setError("STRIPE_CREDENTIAL_REPAIR_FAILED");
            return false;
        }
    }

    private void cancelDiscoverySilently() {
        Cancelable task = discoveryCancelable;
        discoveryCancelable = null;
        discoveryRunning.set(false);
        if (task == null || task.isCompleted()) return;
        task.cancel(new Callback() {
            @Override public void onSuccess() { }
            @Override public void onFailure(TerminalException error) { }
        });
    }

    private void cancelReconnectSilently() {
        Cancelable task = reconnectCancelable;
        reconnectCancelable = null;
        if (task == null || task.isCompleted()) return;
        task.cancel(new Callback() {
            @Override public void onSuccess() { }
            @Override public void onFailure(TerminalException error) { }
        });
    }

    private void finishPaymentFailure(String code) {
        safeErrorCode = code;
        localPaymentState = "SDK_FAILED";
        if (!"TERMINAL".equals(paymentRail)) paymentRail = "TERMINAL";
        if (!"RECOVERY_REQUIRED".equals(paymentRailState)) paymentRailState = "FAILED";
        paymentCancelable = null;
        paymentRunning.set(false);
        readerState = idleReaderState();
    }

    private String idleReaderState() {
        if (firmwareUpdateInProgress) return "UPDATING";
        if (readerRebootInProgress) return "RECONNECTING";
        if (!readerTransportPresent()) return "ABSENT";
        String sdkStatus = terminalConnectionStatusName();
        if ("CONNECTED".equals(sdkStatus) && isReaderConnected()) return "READY";
        if (sdkOwnsConnectionTransition(sdkStatus)) return sdkStatus;
        return reconnectFailed ? "ERROR" : "DISCOVERING";
    }

    private void setError(String code) {
        safeErrorCode = code;
        readerState = readerTransportPresent() ? "ERROR" : "ABSENT";
        Log.w(TAG, "Terminal reader state=" + readerState + ", code=" + code);
    }

    private void bootstrapConnectionBinding() {
        if (!bindingBootstrapRunning.compareAndSet(false, true)) return;
        readerState = "DISCOVERING";
        io.execute(() -> {
            try {
                StripeTerminalBackendClient.ConnectionTokenResult result = backend.fetchConnectionToken(simulatedReaderEnabled());
                String location = blankToNull(result.locationId());
                if (!simulatedReaderEnabled() && location == null) throw new IOException("TERMINAL_LOCATION_BINDING_REQUIRED");
                stripeLocationId = location;
                expectedReaderId = simulatedReaderEnabled() ? null : blankToNull(result.expectedReaderId());
                prefetchedConnectionTokenSecret = result.secret();
                safeErrorCode = null;
            } catch (Exception error) {
                prefetchedConnectionTokenSecret = null;
                setError(StripeTerminalBackendClient.safeCode(error.getMessage()));
            } finally {
                bindingBootstrapRunning.set(false);
            }
            if (simulatedReaderEnabled() || blankToNull(stripeLocationId) != null) main.post(this::ensureStarted);
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
                    StripeTerminalBackendClient.ConnectionTokenResult result = backend.fetchConnectionToken(simulatedReaderEnabled());
                    stripeLocationId = blankToNull(result.locationId());
                    expectedReaderId = simulatedReaderEnabled() ? null : blankToNull(result.expectedReaderId());
                    callback.onSuccess(result.secret());
                } catch (Exception error) {
                    safeErrorCode = StripeTerminalBackendClient.safeCode(error.getMessage());
                    callback.onFailure(new ConnectionTokenException("Chargeurs Terminal token unavailable", error));
                }
            });
        }
    }

    private final class RuntimeTerminalListener implements TerminalListener {
        @Override
        public void onConnectionStatusChange(ConnectionStatus status) {
            if (status == null) return;
            String name = status.name();
            switch (name) {
                case "DISCOVERING", "CONNECTING", "RECONNECTING" -> readerState = name;
                case "CONNECTED" -> {
                    connectionRunning.set(false);
                    discoveryRunning.set(false);
                    Reader connected = Terminal.getInstance().getConnectedReader();
                    if (connected != null && readerMatchesBinding(connected)) acceptConnectedReader(connected);
                }
                case "NOT_CONNECTED" -> {
                    connectionRunning.set(false);
                    discoveryRunning.set(false);
                    stripeReaderId = null;
                    stripeReaderSerial = null;
                    if (bindingMismatchBlocked) {
                        setError("TERMINAL_READER_BINDING_MISMATCH");
                    } else if (firmwareUpdateInProgress) {
                        readerState = "UPDATING";
                    } else if (readerRebootInProgress || reconnectCancelable != null) {
                        readerState = "RECONNECTING";
                    } else if (!readerTransportPresent()) {
                        readerState = "ABSENT";
                    } else if (!paymentRunning.get()) {
                        readerState = reconnectFailed ? "ERROR" : "DISCOVERING";
                    }
                }
                default -> { }
            }
        }

        @Override
        public void onPaymentStatusChange(PaymentStatus status) {
            if (status == null) return;
            String name = status.name();
            if ("PROCESSING".equals(name) || "WAITING_FOR_INPUT".equals(name)) readerState = "BUSY";
            else if (!paymentRunning.get() && !firmwareUpdateInProgress) readerState = idleReaderState();
        }
    }

    private final class RuntimeOfflineListener implements OfflineListener {
        @Override public void onOfflineStatusChange(OfflineStatus offlineStatus) { }
        @Override public void onPaymentIntentForwarded(PaymentIntent paymentIntent, TerminalException error) { }
        @Override public void onForwardingFailure(TerminalException error) {
            Log.w(TAG, "Offline forwarding callback received in online-only kiosk: " + safeTerminalCode(error));
        }
    }

    @Override
    public void onReaderReconnectStarted(Reader reader, Cancelable cancelReconnect, DisconnectReason reason) {
        reconnectCancelable = cancelReconnect;
        reconnectFailed = false;
        connectionRunning.set(false);
        readerState = firmwareUpdateInProgress ? "UPDATING" : "RECONNECTING";
        safeErrorCode = null;
        lastDisconnectReason = reason == null ? null : reason.name();
    }

    @Override
    public void onReaderReconnectSucceeded(Reader reader) {
        reconnectCancelable = null;
        reconnectFailed = false;
        readerRebootInProgress = false;
        acceptConnectedReader(reader);
    }

    @Override
    public void onReaderReconnectFailed(Reader reader) {
        reconnectCancelable = null;
        reconnectFailed = true;
        readerRebootInProgress = false;
        connectionRunning.set(false);
        discoveryRunning.set(false);
        setError("STRIPE_READER_RECONNECT_FAILED");
    }

    @Override
    public void onDisconnect(DisconnectReason reason) {
        lastDisconnectReason = reason == null ? null : reason.name();
        stripeReaderId = null;
        stripeReaderSerial = null;
        connectionRunning.set(false);
        discoveryRunning.set(false);
        if (bindingMismatchBlocked) {
            setError("TERMINAL_READER_BINDING_MISMATCH");
            return;
        }
        if (firmwareUpdateInProgress) {
            readerState = "UPDATING";
            return;
        }
        if (readerRebootInProgress || reconnectCancelable != null) {
            readerState = "RECONNECTING";
            return;
        }
        if (!readerTransportPresent()) {
            readerState = "ABSENT";
            return;
        }
        if (!paymentRunning.get()) readerState = reconnectFailed ? "ERROR" : "RECONNECTING";
    }

    @Override
    public void onStartInstallingUpdate(ReaderSoftwareUpdate update, Cancelable cancelable) {
        firmwareUpdateInProgress = true;
        firmwareUpdateProgress = 0f;
        availableUpdatePresent = true;
        readerState = "UPDATING";
    }

    @Override
    public void onReportReaderSoftwareUpdateProgress(float progress) {
        firmwareUpdateInProgress = true;
        firmwareUpdateProgress = Math.max(0f, Math.min(1f, progress));
        readerState = "UPDATING";
    }

    @Override
    public void onFinishInstallingUpdate(ReaderSoftwareUpdate update, TerminalException error) {
        firmwareUpdateInProgress = false;
        if (error != null) {
            setError(safeTerminalCode(error));
            return;
        }
        firmwareUpdateProgress = 1f;
        availableUpdatePresent = false;
        readerState = idleReaderState();
    }

    @Override public void onRequestReaderInput(ReaderInputOptions options) { if (paymentRunning.get()) readerState = "BUSY"; }
    @Override public void onRequestReaderDisplayMessage(ReaderDisplayMessage message) { if (paymentRunning.get()) readerState = "BUSY"; }
    @Override public void onReportAvailableUpdate(ReaderSoftwareUpdate update) { availableUpdatePresent = update != null; }
    @Override public void onReportReaderEvent(ReaderEvent event) { }
    @Override public void onReportLowBatteryWarning() { lowBatteryWarning = true; }
    @Override public void onBatteryLevelUpdate(float batteryLevel, BatteryStatus batteryStatus, boolean isCharging) {
        readerBatteryLevel = batteryLevel;
        readerBatteryStatus = batteryStatus == null ? null : batteryStatus.name();
        readerCharging = isCharging;
        if (batteryLevel > 0.5f) lowBatteryWarning = false;
    }

    private boolean usbPresent() {
        return WisePadUsbProbe.snapshot(context).optBoolean("present", false);
    }

    private boolean simulatedReaderEnabled() {
        return simulatedReaderEnabledForBuild(
            "staging".equals(BuildConfig.BUILD_ENVIRONMENT),
            BuildConfig.STRIPE_TERMINAL_SIMULATED_TEST_ENABLED
        );
    }

    private boolean readerTransportPresent() {
        return simulatedReaderEnabled() || usbPresent();
    }

    private boolean isReaderConnected() {
        return Terminal.isInitialized() && Terminal.getInstance().getConnectedReader() != null;
    }

    private String terminalConnectionStatusName() {
        try {
            if (!Terminal.isInitialized()) return "NOT_INITIALIZED";
            ConnectionStatus status = Terminal.getInstance().getConnectionStatus();
            return status == null ? "UNKNOWN" : status.name();
        } catch (RuntimeException error) {
            return "UNKNOWN";
        }
    }

    private static boolean isCancellation(TerminalException error) {
        if (error == null) return false;
        String code = error.getErrorCode() == null ? "" : error.getErrorCode().name();
        String message = error.getMessage() == null ? "" : error.getMessage();
        String combined = (code + " " + message).toUpperCase(Locale.ROOT);
        return combined.contains("CANCEL") || combined.contains("ABORT");
    }

    private static String safeTerminalCode(TerminalException error) {
        if (error == null || error.getErrorCode() == null) return "STRIPE_TERMINAL_ERROR";
        return StripeTerminalBackendClient.safeCode("STRIPE_" + error.getErrorCode().name());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static Object nullableJson(String value) {
        return value == null || value.isBlank() ? JSONObject.NULL : value;
    }
}
