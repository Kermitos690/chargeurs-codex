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
import com.stripe.stripeterminal.external.callable.PaymentIntentCallback;
import com.stripe.stripeterminal.external.callable.ReaderCallback;
import com.stripe.stripeterminal.external.callable.TerminalListener;
import com.stripe.stripeterminal.external.callable.ReaderListener;
import com.stripe.stripeterminal.external.models.BatteryStatus;
import com.stripe.stripeterminal.external.models.CollectConfiguration;
import com.stripe.stripeterminal.external.models.ConnectionConfiguration;
import com.stripe.stripeterminal.external.models.ConnectionStatus;
import com.stripe.stripeterminal.external.models.ConnectionTokenException;
import com.stripe.stripeterminal.external.models.DiscoveryConfiguration;
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
 * TEST-only Stripe Terminal 3.0.0 USB runtime for DTA21269.
 *
 * Stripe documents 3.0.0 as the first Android SDK version supporting WisePad
 * 3 over USB. The runtime is intentionally payment-reader only: it has no
 * battery-release capability and does not weaken HARDWARE_EJECTION_ENABLED.
 */
final class StripeTerminalReaderRuntime implements ReaderListener {
    private static final String TAG = "ChargeursStripeV2";
    private static final String PREFS = "stripe_terminal_reader";
    private static final String LAST_READER_ID = "last_reader_id";
    // Kept package-visible so the build contract can prevent diagnostics from
    // drifting away from the pinned SDK dependency.
    static final String SDK_COMPAT = "3.0.0-test-only";

    private final Context context;
    private final KioskConfig config;
    private final StripeTerminalBackendClient backend;
    private final SharedPreferences preferences;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicBoolean discoveryRunning = new AtomicBoolean(false);
    // Stripe rejects a second connectUsbReader call while the first one is in
    // flight. WebView diagnostics poll frequently, so readerState alone cannot
    // provide the required mutual exclusion.
    private final AtomicBoolean connectionRunning = new AtomicBoolean(false);
    private final AtomicBoolean paymentRunning = new AtomicBoolean(false);
    private final AtomicBoolean paymentCancellationRunning = new AtomicBoolean(false);
    private final AtomicInteger paymentOperationGeneration = new AtomicInteger(0);
    private final AtomicBoolean bindingBootstrapRunning = new AtomicBoolean(false);
    private final AtomicInteger discoveryGeneration = new AtomicInteger(0);

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
    private volatile String correlationId;
    private Cancelable discoveryCancelable;
    private Cancelable paymentCancelable;

    StripeTerminalReaderRuntime(Context context, KioskConfig config) {
        this.context = context.getApplicationContext();
        this.config = config;
        this.backend = new StripeTerminalBackendClient(config);
        this.preferences = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED) {
            readerState = usbPresent() ? "DISCOVERING" : "ABSENT";
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
        if (!usbPresent()) {
            if (!"BUSY".equals(readerState) && !"UPDATING".equals(readerState)) readerState = "ABSENT";
            return;
        }
        if (bindingMismatchBlocked) {
            readerState = "ERROR";
            safeErrorCode = "TERMINAL_READER_BINDING_MISMATCH";
            return;
        }
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            setError("STRIPE_FINE_LOCATION_PERMISSION_REQUIRED");
            return;
        }
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
            if (canStartUsbDiscovery(discoveryRunning.get(), connectionRunning.get(), paymentRunning.get())) startDiscovery();
        });
    }

    /**
     * Explicit operator/UI reconnect request. A stale discovery task is
     * invalidated and replaced, but an active payment or healthy reader is never
     * disconnected. No PaymentIntent or other financial side effect is created.
     */
    void requestReconnect() {
        if (!BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED) {
            readerState = "UNAVAILABLE";
            return;
        }
        if (!usbPresent()) {
            readerState = "ABSENT";
            return;
        }
        if (paymentRunning.get() || connectionRunning.get()) return;

        main.post(() -> {
            if (!ensureTerminalInitialized()) return;
            Reader connected = Terminal.getInstance().getConnectedReader();
            if (connected != null && readerMatchesBinding(connected)) {
                acceptConnectedReader(connected);
                return;
            }
            if (canClearCachedCredentialsForRepair(
                readerState,
                paymentRunning.get(),
                activeRentalSessionId,
                connected != null
            )) {
                try {
                    // This is deliberately an explicit retry-only repair, not
                    // an automatic startup action. Stripe requires no reader
                    // to be connected. It clears Terminal credentials only;
                    // it does not clear kiosk storage, create a payment, or
                    // release any hardware.
                    Terminal.getInstance().clearCachedCredentials();
                    prefetchedConnectionTokenSecret = null;
                    Log.i(TAG, "Cleared Stripe Terminal cached credentials for explicit reader repair");
                } catch (RuntimeException error) {
                    setError("STRIPE_CREDENTIAL_REPAIR_FAILED");
                    return;
                }
            }

            discoveryGeneration.incrementAndGet();
            cancelDiscoverySilently();
            discoveryRunning.set(false);
            safeErrorCode = null;
            readerState = "RECONNECTING";
            main.postDelayed(this::ensureStarted, 250L);
        });
    }

    JSONObject snapshot() {
        boolean present = usbPresent();
        if (!BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED) readerState = "UNAVAILABLE";
        else if (!present && !paymentRunning.get() && !"UPDATING".equals(readerState)) readerState = "ABSENT";
        else if (present && ("ABSENT".equals(readerState) || "ERROR".equals(readerState))) ensureStarted();

        JSONObject usb = WisePadUsbProbe.snapshot(context);
        String capability = "READY".equals(readerState) && bindingValidated()
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
                "transport", "usb",
                "stripeSdk", SDK_COMPAT,
                "compatibilityLane", true,
                "usbPresent", usb.optBoolean("present", false),
                "usbPermission", usb.optBoolean("permission", false),
                "locationPermission", context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED,
                "discoveryRunning", discoveryRunning.get(),
                "connectionRunning", connectionRunning.get(),
                "discoveryGeneration", discoveryGeneration.get(),
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
        readerState = "BUSY";

        io.execute(() -> {
            try {
                StripeTerminalBackendClient.PaymentIntentResult result = backend.createPaymentIntent(rentalSessionId);
                if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                paymentRail = result.rail();
                paymentRailState = result.railState();
                correlationId = blankToNull(result.correlationId());
                if (!"TERMINAL".equals(result.rail())) throw new IOException("PAYMENT_RAIL_ALREADY_CLAIMED");
                activePaymentIntentId = result.paymentIntentId();
                if (blankToNull(result.locationId()) != null) stripeLocationId = result.locationId();
                if (blankToNull(result.expectedReaderId()) != null) expectedReaderId = result.expectedReaderId();
                localPaymentState = "RETRIEVING_INTENT";
                String clientSecret = result.clientSecret();
                main.post(() -> retrieveAndCollect(clientSecret, operationGeneration));
            } catch (Exception error) {
                if (isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) {
                    finishPaymentFailure(StripeTerminalBackendClient.safeCode(error.getMessage()));
                }
            }
        });
        return JsonObjects.of("ok", true, "accepted", true, "rail", "TERMINAL", "railState", "CLAIMING");
    }

    /**
     * Customer-requested cancellation before a confirmed payment. We first
     * cancel local collection so the reader cannot still accept a card while
     * the server is cancelling the PaymentIntent. The backend then checks the
     * authoritative Stripe status; any raced/confirmed side effect remains
     * fail-closed and is surfaced as recovery rather than retried.
     */
    JSONObject cancelTerminalPayment() {
        String rental = activeRentalSessionId;
        if (rental == null || rental.isBlank()) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_PAYMENT_NOT_ACTIVE");
        }
        if (!paymentCancellationRunning.compareAndSet(false, true)) {
            return JsonObjects.of("ok", false, "code", "TERMINAL_CANCEL_IN_PROGRESS");
        }
        // Every collect/confirm callback created by the previous operation is
        // now stale. It must never overwrite the authoritative cancellation
        // result after the WisePad has acknowledged cancellation.
        paymentOperationGeneration.incrementAndGet();
        localPaymentState = "CANCELLING";
        paymentRail = "TERMINAL";
        paymentRailState = "CANCELLING";
        Cancelable collection = paymentCancelable;
        if (collection != null && !collection.isCompleted()) {
            collection.cancel(new Callback() {
                @Override public void onSuccess() { cancelTerminalIntentOnServer(rental); }
                @Override public void onFailure(TerminalException error) {
                    // A reader may report an already-ended/cancelled collection
                    // while the server rail is still engaged. The server is the
                    // authority for cancelling the PaymentIntent and releasing
                    // that rail, so a local callback failure must not strand the
                    // kiosk in BUSY/ENGAGED.
                    safeErrorCode = safeTerminalCode(error);
                    cancelTerminalIntentOnServer(rental);
                }
            });
        } else {
            cancelTerminalIntentOnServer(rental);
        }
        return JsonObjects.of("ok", true, "accepted", true, "rail", "TERMINAL", "railState", "CANCELLING");
    }

    private void cancelAfterReaderStop() {
        String rental = activeRentalSessionId;
        if (rental == null || rental.isBlank()) return;
        if (!paymentCancellationRunning.compareAndSet(false, true)) return;
        // The reader has already ended collection. Do not invoke cancel() a
        // second time; invalidate callbacks and move directly to the same
        // authoritative server cancellation used by the kiosk button.
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
                    localPaymentState = "CANCELLED";
                    activePaymentIntentId = null;
                    activeRentalSessionId = null;
                    paymentCancelable = null;
                    paymentRunning.set(false);
                    safeErrorCode = null;
                    readerState = usbPresent() && Terminal.isInitialized() && Terminal.getInstance().getConnectedReader() != null ? "READY" : "ERROR";
                } else {
                    // Never pretend that a local stop released a server claim.
                    // An ambiguous Stripe state needs the recovery UI rather
                    // than a second payment attempt or any hardware action.
                    localPaymentState = "RECOVERY_REQUIRED";
                    recoveryRequired = true;
                    paymentRunning.set(false);
                    safeErrorCode = "PAYMENT_RECONCILIATION_REQUIRED";
                    readerState = usbPresent() && Terminal.isInitialized() && Terminal.getInstance().getConnectedReader() != null ? "READY" : "ERROR";
                }
            } catch (IOException error) {
                recoveryRequired = true;
                paymentRailState = "RECOVERY_REQUIRED";
                safeErrorCode = StripeTerminalBackendClient.safeCode(error.getMessage());
            } finally {
                paymentCancellationRunning.set(false);
            }
        });
    }

    void refreshPaymentState(boolean reconcile) {
        String rental = activeRentalSessionId;
        if (rental == null || rental.isBlank()) return;
        final int operationGeneration = paymentOperationGeneration.get();
        io.execute(() -> {
            try {
                StripeTerminalBackendClient.PaymentStateResult state = backend.getPaymentState(rental, reconcile);
                // State reads are queued while the WebView polls. A response
                // that began before a cancellation must not resurrect the
                // released TERMINAL rail after the cancellation is confirmed.
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
            } catch (IOException error) {
                safeErrorCode = StripeTerminalBackendClient.safeCode(error.getMessage());
            }
        });
    }

    static boolean isCurrentPaymentOperation(int callbackGeneration, int activeGeneration) {
        return callbackGeneration == activeGeneration;
    }

    static boolean canStartUsbDiscovery(boolean discoveryRunning, boolean connectionRunning, boolean paymentRunning) {
        return !discoveryRunning && !connectionRunning && !paymentRunning;
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

    private void retrieveAndCollect(String clientSecret, int operationGeneration) {
        if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
        if (!Terminal.isInitialized() || Terminal.getInstance().getConnectedReader() == null) {
            finishPaymentFailure("TERMINAL_DISCONNECTED");
            return;
        }
        Terminal.getInstance().retrievePaymentIntent(clientSecret, new PaymentIntentCallback() {
            @Override
            public void onSuccess(PaymentIntent paymentIntent) {
                if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                localPaymentState = "COLLECTING";
                paymentRailState = "PROCESSING";
                CollectConfiguration collect = new CollectConfiguration.Builder()
                    .skipTipping(true)
                    .build();
                paymentCancelable = Terminal.getInstance().collectPaymentMethod(
                    paymentIntent,
                    new PaymentIntentCallback() {
                        @Override
                        public void onSuccess(PaymentIntent collected) {
                            if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                            paymentCancelable = null;
                            localPaymentState = "PROCESSING";
                            Terminal.getInstance().confirmPaymentIntent(collected, new PaymentIntentCallback() {
                                @Override
                                public void onSuccess(PaymentIntent processed) {
                                    if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                                    activePaymentIntentId = processed.getId();
                                    localPaymentState = "SDK_SUCCEEDED";
                                    paymentRailState = "PROCESSING";
                                    paymentRunning.set(false);
                                    readerState = "READY";
                                    refreshPaymentState(true);
                                }

                                @Override
                                public void onFailure(TerminalException error) {
                                    if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                                    finishPaymentFailure(safeTerminalCode(error));
                                    refreshPaymentState(true);
                                }
                            });
                        }

                        @Override
                        public void onFailure(TerminalException error) {
                            if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                            paymentCancelable = null;
                            if (isCancellation(error)) {
                                // STOP on the WisePad reaches this callback. It
                                // has the same two-phase cancellation contract
                                // as the kiosk button: invalidate callbacks,
                                // then let the backend safely cancel/release.
                                cancelAfterReaderStop();
                                return;
                            }
                            finishPaymentFailure(safeTerminalCode(error));
                            refreshPaymentState(true);
                        }
                    },
                    collect
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
                Terminal.initTerminal(
                    context,
                    LogLevel.ERROR,
                    new BackendConnectionTokenProvider(),
                    new RuntimeTerminalListener()
                );
            }
            return true;
        } catch (Exception error) {
            Log.e(TAG, "Stripe Terminal 3.0.0 init failed", error);
            setError("STRIPE_TERMINAL_V2_INIT_FAILED");
            return false;
        }
    }

    private void startDiscovery() {
        if (!BuildConfig.STRIPE_TERMINAL_USB_TEST_ENABLED || !usbPresent()) {
            readerState = usbPresent() ? "UNAVAILABLE" : "ABSENT";
            return;
        }
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            setError("STRIPE_FINE_LOCATION_PERMISSION_REQUIRED");
            return;
        }
        if (connectionRunning.get() || !discoveryRunning.compareAndSet(false, true)) return;

        final int generation = discoveryGeneration.incrementAndGet();
        readerState = "DISCOVERING";
        safeErrorCode = null;
        Log.i(TAG, "USB discovery started; locationBound=" + (blankToNull(stripeLocationId) != null)
            + ", readerBound=" + (blankToNull(expectedReaderId) != null));
        DiscoveryConfiguration discoveryConfig = new DiscoveryConfiguration.UsbDiscoveryConfiguration(0, false);
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
                    Log.i(TAG, "USB discovery update; count=" + (readers == null ? 0 : readers.size())
                        + ", candidate=" + (candidate != null)
                        + ", discoveredReaderId=" + (discoveredReaderId == null ? "none" : discoveredReaderId));
                    if (candidate != null) connect(candidate, generation);
                }
            },
            new Callback() {
                @Override
                public void onSuccess() {
                    if (generation != discoveryGeneration.get()) return;
                    discoveryCancelable = null;
                    discoveryRunning.set(false);
                    if (Terminal.getInstance().getConnectedReader() == null && usbPresent() && !"CONNECTING".equals(readerState)) {
                        readerState = "ERROR";
                        safeErrorCode = "STRIPE_READER_NOT_DISCOVERED";
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
        String expected = blankToNull(expectedReaderId);
        String remembered = preferences.getString(LAST_READER_ID, null);
        if (expected != null) {
            for (Reader reader : readers) if (expected.equals(reader.getId())) return reader;
            // USB discovery supplies no Stripe reader ID until after a physical
            // connection on some WisePad 3 firmware. A single attached reader
            // is safe to connect non-financially; its Stripe ID is verified in
            // the connection callback before it can become READY.
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
        if ("CONNECTING".equals(readerState) || "READY".equals(readerState) || !connectionRunning.compareAndSet(false, true)) return;
        String location = blankToNull(stripeLocationId);
        if (location == null) {
            connectionRunning.set(false);
            setError("TERMINAL_LOCATION_BINDING_REQUIRED");
            return;
        }
        readerState = "CONNECTING";
        Log.i(TAG, "USB reader connection requested; expectedReaderBound="
            + (blankToNull(expectedReaderId) != null));
        Terminal.getInstance().connectUsbReader(
            reader,
            new ConnectionConfiguration.UsbConnectionConfiguration(location),
            this,
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
        stripeReaderId = reader.getId();
        stripeReaderSerial = reader.getSerialNumber();
        if (reader.getLocation() != null && reader.getLocation().getId() != null) {
            stripeLocationId = reader.getLocation().getId();
        }
        if (blankToNull(stripeReaderId) != null) preferences.edit().putString(LAST_READER_ID, stripeReaderId).apply();
        else if (blankToNull(stripeReaderSerial) != null) preferences.edit().putString(LAST_READER_ID, stripeReaderSerial).apply();
        safeErrorCode = null;
        readerState = paymentRunning.get() ? "BUSY" : "READY";
        Log.i(TAG, "WisePad USB connected through Stripe Terminal 3.0.0");
    }

    private boolean readerMatchesBinding(Reader reader) {
        if (reader == null) return false;
        String expected = blankToNull(expectedReaderId);
        if (expected != null && !expected.equals(reader.getId())) return false;
        String expectedLocation = blankToNull(stripeLocationId);
        return expectedLocation == null || reader.getLocation() == null || reader.getLocation().getId() == null
            || expectedLocation.equals(reader.getLocation().getId());
    }

    private boolean bindingValidated() {
        if (!"READY".equals(readerState)) return false;
        if (blankToNull(stripeLocationId) == null || !Terminal.isInitialized()) return false;
        Reader connected = Terminal.getInstance().getConnectedReader();
        return connected != null && readerMatchesBinding(connected);
    }

    private void disconnectForBindingMismatch() {
        try {
            Terminal.getInstance().disconnectReader(new Callback() {
                @Override public void onSuccess() { Log.w(TAG, "Disconnected mismatched USB reader"); }
                @Override public void onFailure(TerminalException error) {
                    Log.w(TAG, "Failed to disconnect mismatched USB reader: " + safeTerminalCode(error));
                }
            });
        } catch (RuntimeException error) {
            Log.w(TAG, "Failed to start mismatched USB reader disconnect", error);
        }
    }

    private boolean usbPresent() {
        return WisePadUsbProbe.snapshot(context).optBoolean("present", false);
    }

    private void cancelDiscoverySilently() {
        Cancelable task = discoveryCancelable;
        discoveryCancelable = null;
        discoveryRunning.set(false);
        if (task == null) return;
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
        paymentRunning.set(false);
        readerState = usbPresent() && Terminal.isInitialized() && Terminal.getInstance().getConnectedReader() != null ? "READY" : "ERROR";
    }

    private void setError(String code) {
        safeErrorCode = code;
        readerState = usbPresent() ? "ERROR" : "ABSENT";
        Log.w(TAG, "Terminal reader state=" + readerState + ", code=" + code);
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

    private void bootstrapConnectionBinding() {
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
                Log.i(TAG, "Terminal binding fetched; locationBound=true, readerBound="
                    + (expectedReaderId != null));
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
                    Log.i(TAG, "Terminal token refreshed; locationBound=" + (stripeLocationId != null)
                        + ", readerBound=" + (expectedReaderId != null));
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
        public void onUnexpectedReaderDisconnect(Reader reader) {
            stripeReaderId = null;
            stripeReaderSerial = null;
            discoveryGeneration.incrementAndGet();
            cancelDiscoverySilently();
            if (bindingMismatchBlocked) {
                readerState = "ERROR";
                safeErrorCode = "TERMINAL_READER_BINDING_MISMATCH";
                return;
            }
            readerState = usbPresent() ? "RECONNECTING" : "ABSENT";
            if (usbPresent() && !paymentRunning.get()) main.postDelayed(StripeTerminalReaderRuntime.this::ensureStarted, 250L);
        }

        @Override
        public void onConnectionStatusChange(ConnectionStatus status) {
            if (status == null) return;
            switch (status.name()) {
                case "CONNECTING" -> readerState = "CONNECTING";
                case "CONNECTED" -> {
                    Reader connected = Terminal.getInstance().getConnectedReader();
                    if (connected != null && readerMatchesBinding(connected)) acceptConnectedReader(connected);
                }
                case "NOT_CONNECTED" -> {
                    if (bindingMismatchBlocked) {
                        readerState = "ERROR";
                        safeErrorCode = "TERMINAL_READER_BINDING_MISMATCH";
                        return;
                    }
                    if (!paymentRunning.get()) {
                        if (usbPresent()) {
                            readerState = "RECONNECTING";
                            if (!discoveryRunning.get()) main.postDelayed(StripeTerminalReaderRuntime.this::ensureStarted, 250L);
                        } else {
                            readerState = "ABSENT";
                        }
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
            else if (!paymentRunning.get() && Terminal.getInstance().getConnectedReader() != null && bindingValidated()) readerState = "READY";
        }
    }

    @Override
    public void onStartInstallingUpdate(ReaderSoftwareUpdate update, Cancelable cancelable) {
        readerState = "UPDATING";
    }

    @Override public void onReportReaderSoftwareUpdateProgress(float progress) { readerState = "UPDATING"; }

    @Override
    public void onFinishInstallingUpdate(ReaderSoftwareUpdate update, TerminalException error) {
        if (error != null) setError(safeTerminalCode(error));
        else readerState = Terminal.getInstance().getConnectedReader() != null ? "READY" : (usbPresent() ? "DISCOVERING" : "ABSENT");
    }

    @Override public void onRequestReaderInput(ReaderInputOptions options) { readerState = "BUSY"; }
    @Override public void onRequestReaderDisplayMessage(ReaderDisplayMessage message) { readerState = "BUSY"; }
    @Override public void onReportAvailableUpdate(ReaderSoftwareUpdate update) { }
    @Override public void onReportReaderEvent(ReaderEvent event) { }
    @Override public void onReportLowBatteryWarning() { }
    @Override public void onBatteryLevelUpdate(float batteryLevel, BatteryStatus batteryStatus, boolean isCharging) { }
}
