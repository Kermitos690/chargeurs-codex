package ch.chargeurs.kiosk;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.stripe.stripeterminal.Terminal;
import com.stripe.stripeterminal.external.callable.BluetoothReaderListener;
import com.stripe.stripeterminal.external.callable.Callback;
import com.stripe.stripeterminal.external.callable.Cancelable;
import com.stripe.stripeterminal.external.callable.ConnectionTokenCallback;
import com.stripe.stripeterminal.external.callable.ConnectionTokenProvider;
import com.stripe.stripeterminal.external.callable.DiscoveryListener;
import com.stripe.stripeterminal.external.callable.PaymentIntentCallback;
import com.stripe.stripeterminal.external.callable.ReaderCallback;
import com.stripe.stripeterminal.external.callable.TerminalListener;
import com.stripe.stripeterminal.external.models.BatteryStatus;
import com.stripe.stripeterminal.external.models.CollectConfiguration;
import com.stripe.stripeterminal.external.models.ConnectionConfiguration;
import com.stripe.stripeterminal.external.models.ConnectionStatus;
import com.stripe.stripeterminal.external.models.ConnectionTokenException;
import com.stripe.stripeterminal.external.models.DiscoveryConfiguration;
import com.stripe.stripeterminal.external.models.DiscoveryMethod;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * STAGING TEST-only Stripe Terminal simulated-reader lane.
 *
 * This is intentionally separate from StripeTerminalReaderRuntime so the proven
 * physical WisePad USB path remains unchanged. It uses Stripe's SDK-provided
 * simulated Bluetooth reader to exercise the same kiosk backend payment rail,
 * PaymentIntent collection/processing and reconciliation without a physical
 * test card. It is never production eligible and never performs cabinet I/O.
 */
final class StripeTerminalSimulatedRuntime implements BluetoothReaderListener {
    private static final String TAG = "ChargeursStripeSim";
    private static final String SDK_COMPAT = "2.22.0-simulated-test-only";

    private final Context context;
    private final KioskConfig config;
    private final StripeTerminalBackendClient backend;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicBoolean discoveryRunning = new AtomicBoolean(false);
    private final AtomicBoolean paymentRunning = new AtomicBoolean(false);
    private final AtomicBoolean bindingBootstrapRunning = new AtomicBoolean(false);

    private volatile String readerState = "DISCOVERING";
    private volatile String safeErrorCode;
    private volatile String stripeReaderId;
    private volatile String stripeReaderSerial;
    private volatile String stripeLocationId;
    private volatile String prefetchedConnectionTokenSecret;
    private volatile String localPaymentState = "IDLE";
    private volatile String activeRentalSessionId;
    private volatile String activePaymentIntentId;
    private volatile String paymentRail = "NONE";
    private volatile String paymentRailState = "UNCLAIMED";
    private volatile boolean serverConfirmed;
    private volatile boolean recoveryRequired;
    private volatile String correlationId;
    private Cancelable discoveryCancelable;
    private Cancelable paymentCancelable;

    StripeTerminalSimulatedRuntime(Context context, KioskConfig config) {
        this.context = context.getApplicationContext();
        this.config = config;
        this.backend = new StripeTerminalBackendClient(config);
    }

    boolean matchesStation(String stationId) {
        return stationId != null && stationId.equals(config.stationId());
    }

    void ensureStarted() {
        if (!BuildConfig.STRIPE_TERMINAL_SIMULATED_TEST_ENABLED) {
            readerState = "UNAVAILABLE";
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
            if (connected != null) {
                acceptConnectedReader(connected);
                return;
            }
            if (!discoveryRunning.get() && !paymentRunning.get()) startDiscovery();
        });
    }

    JSONObject snapshot() {
        if (!BuildConfig.STRIPE_TERMINAL_SIMULATED_TEST_ENABLED) readerState = "UNAVAILABLE";
        else if ("ERROR".equals(readerState)) ensureStarted();

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
                "transport", "simulated",
                "simulated", true,
                "stripeSdk", SDK_COMPAT,
                "compatibilityLane", true,
                "usbPresent", false,
                "usbPermission", false,
                "stripeReaderId", nullableJson(stripeReaderId),
                "stripeReaderSerial", nullableJson(stripeReaderSerial),
                "stripeLocationId", nullableJson(stripeLocationId),
                "expectedReaderId", JSONObject.NULL,
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
                paymentRail = result.rail();
                paymentRailState = result.railState();
                correlationId = blankToNull(result.correlationId());
                if (!"TERMINAL".equals(result.rail())) throw new IOException("PAYMENT_RAIL_ALREADY_CLAIMED");
                activePaymentIntentId = result.paymentIntentId();
                if (blankToNull(result.locationId()) != null) stripeLocationId = result.locationId();
                localPaymentState = "RETRIEVING_INTENT";
                String clientSecret = result.clientSecret();
                main.post(() -> retrieveAndCollect(clientSecret));
            } catch (Exception error) {
                finishPaymentFailure(StripeTerminalBackendClient.safeCode(error.getMessage()));
            }
        });
        return JsonObjects.of("ok", true, "accepted", true, "rail", "TERMINAL", "railState", "CLAIMING");
    }

    void refreshPaymentState(boolean reconcile) {
        String rental = activeRentalSessionId;
        if (rental == null || rental.isBlank()) return;
        io.execute(() -> {
            try {
                StripeTerminalBackendClient.PaymentStateResult state = backend.getPaymentState(rental, reconcile);
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

    private void retrieveAndCollect(String clientSecret) {
        if (!Terminal.isInitialized() || Terminal.getInstance().getConnectedReader() == null) {
            finishPaymentFailure("TERMINAL_DISCONNECTED");
            return;
        }
        Terminal.getInstance().retrievePaymentIntent(clientSecret, new PaymentIntentCallback() {
            @Override
            public void onSuccess(PaymentIntent paymentIntent) {
                localPaymentState = "COLLECTING";
                paymentRailState = "PROCESSING";
                CollectConfiguration collect = new CollectConfiguration.Builder()
                    .skipTipping(true)
                    .setMoto(false)
                    .build();
                paymentCancelable = Terminal.getInstance().collectPaymentMethod(
                    paymentIntent,
                    new PaymentIntentCallback() {
                        @Override
                        public void onSuccess(PaymentIntent collected) {
                            paymentCancelable = null;
                            localPaymentState = "PROCESSING";
                            Terminal.getInstance().processPayment(collected, new PaymentIntentCallback() {
                                @Override
                                public void onSuccess(PaymentIntent processed) {
                                    activePaymentIntentId = processed.getId();
                                    localPaymentState = "SDK_SUCCEEDED";
                                    paymentRailState = "PROCESSING";
                                    paymentRunning.set(false);
                                    readerState = "READY";
                                    Log.i(TAG, "Simulated Stripe Terminal payment processed: " + processed.getId());
                                    refreshPaymentState(true);
                                }

                                @Override
                                public void onFailure(TerminalException error) {
                                    finishPaymentFailure(safeTerminalCode(error));
                                    refreshPaymentState(true);
                                }
                            });
                        }

                        @Override
                        public void onFailure(TerminalException error) {
                            paymentCancelable = null;
                            finishPaymentFailure(safeTerminalCode(error));
                            refreshPaymentState(true);
                        }
                    },
                    collect
                );
            }

            @Override
            public void onFailure(TerminalException error) {
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
            Log.e(TAG, "Stripe Terminal simulated init failed", error);
            setError("STRIPE_TERMINAL_SIM_INIT_FAILED");
            return false;
        }
    }

    private void startDiscovery() {
        if (!BuildConfig.STRIPE_TERMINAL_SIMULATED_TEST_ENABLED) {
            readerState = "UNAVAILABLE";
            return;
        }
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            setError("STRIPE_FINE_LOCATION_PERMISSION_REQUIRED");
            return;
        }
        if (!discoveryRunning.compareAndSet(false, true)) return;
        readerState = "DISCOVERING";
        safeErrorCode = null;
        DiscoveryConfiguration discovery = new DiscoveryConfiguration(0, DiscoveryMethod.BLUETOOTH_SCAN, true);
        discoveryCancelable = Terminal.getInstance().discoverReaders(
            discovery,
            new DiscoveryListener() {
                @Override
                public void onUpdateDiscoveredReaders(List<Reader> readers) {
                    if (readers != null && !readers.isEmpty()) connect(readers.get(0));
                }
            },
            new Callback() {
                @Override
                public void onSuccess() {
                    discoveryCancelable = null;
                    discoveryRunning.set(false);
                    if (Terminal.getInstance().getConnectedReader() == null && !"CONNECTING".equals(readerState)) {
                        setError("STRIPE_SIMULATED_READER_NOT_DISCOVERED");
                    }
                }

                @Override
                public void onFailure(TerminalException error) {
                    discoveryCancelable = null;
                    discoveryRunning.set(false);
                    setError(safeTerminalCode(error));
                }
            }
        );
    }

    private void connect(Reader reader) {
        if ("CONNECTING".equals(readerState) || "READY".equals(readerState)) return;
        String location = blankToNull(stripeLocationId);
        if (location == null) {
            setError("TERMINAL_LOCATION_BINDING_REQUIRED");
            return;
        }
        readerState = "CONNECTING";
        Terminal.getInstance().connectBluetoothReader(
            reader,
            new ConnectionConfiguration.BluetoothConnectionConfiguration(location),
            this,
            new ReaderCallback() {
                @Override
                public void onSuccess(Reader connected) {
                    discoveryRunning.set(false);
                    cancelDiscoverySilently();
                    acceptConnectedReader(connected);
                }

                @Override
                public void onFailure(TerminalException error) {
                    discoveryRunning.set(false);
                    setError(safeTerminalCode(error));
                }
            }
        );
    }

    private void acceptConnectedReader(Reader reader) {
        stripeReaderId = reader.getId();
        stripeReaderSerial = reader.getSerialNumber();
        if (reader.getLocation() != null && reader.getLocation().getId() != null) {
            stripeLocationId = reader.getLocation().getId();
        }
        safeErrorCode = null;
        readerState = paymentRunning.get() ? "BUSY" : "READY";
        Log.i(TAG, "Stripe simulated reader connected through Terminal 2.22");
    }

    private boolean bindingValidated() {
        if (!"READY".equals(readerState)) return false;
        if (blankToNull(stripeLocationId) == null || !Terminal.isInitialized()) return false;
        return Terminal.getInstance().getConnectedReader() != null;
    }

    private void cancelDiscoverySilently() {
        Cancelable task = discoveryCancelable;
        discoveryCancelable = null;
        if (task == null) return;
        task.cancel(new Callback() {
            @Override public void onSuccess() {}
            @Override public void onFailure(TerminalException error) {}
        });
    }

    private void finishPaymentFailure(String code) {
        safeErrorCode = code;
        localPaymentState = "SDK_FAILED";
        if (!"TERMINAL".equals(paymentRail)) paymentRail = "TERMINAL";
        if (!"RECOVERY_REQUIRED".equals(paymentRailState)) paymentRailState = "FAILED";
        paymentRunning.set(false);
        readerState = Terminal.isInitialized() && Terminal.getInstance().getConnectedReader() != null ? "READY" : "ERROR";
    }

    private void setError(String code) {
        safeErrorCode = code;
        readerState = "ERROR";
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
            readerState = "RECONNECTING";
            ensureStarted();
        }

        @Override
        public void onConnectionStatusChange(ConnectionStatus status) {
            if (status == null) return;
            switch (status.name()) {
                case "CONNECTING" -> readerState = "CONNECTING";
                case "CONNECTED" -> {
                    Reader connected = Terminal.getInstance().getConnectedReader();
                    if (connected != null) acceptConnectedReader(connected);
                }
                case "NOT_CONNECTED" -> {
                    if (!paymentRunning.get()) readerState = "DISCOVERING";
                }
                default -> { }
            }
        }

        @Override
        public void onPaymentStatusChange(PaymentStatus status) {
            if (status == null) return;
            String name = status.name();
            if ("PROCESSING".equals(name) || "WAITING_FOR_INPUT".equals(name)) readerState = "BUSY";
            else if (!paymentRunning.get() && Terminal.getInstance().getConnectedReader() != null) readerState = "READY";
        }
    }

    @Override public void onStartInstallingUpdate(ReaderSoftwareUpdate update, Cancelable cancelable) { readerState = "UPDATING"; }
    @Override public void onReportReaderSoftwareUpdateProgress(float progress) { readerState = "UPDATING"; }
    @Override public void onFinishInstallingUpdate(ReaderSoftwareUpdate update, TerminalException error) {
        if (error != null) setError(safeTerminalCode(error));
        else readerState = Terminal.getInstance().getConnectedReader() != null ? "READY" : "DISCOVERING";
    }
    @Override public void onRequestReaderInput(ReaderInputOptions options) { readerState = "BUSY"; }
    @Override public void onRequestReaderDisplayMessage(ReaderDisplayMessage message) { readerState = "BUSY"; }
    @Override public void onReportAvailableUpdate(ReaderSoftwareUpdate update) {}
    @Override public void onReportReaderEvent(ReaderEvent event) {}
    @Override public void onReportLowBatteryWarning() {}
    @Override public void onBatteryLevelUpdate(float batteryLevel, BatteryStatus batteryStatus, boolean isCharging) {}
}
