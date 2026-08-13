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
import com.stripe.stripeterminal.external.callable.UsbReaderListener;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * TEST-only Stripe Terminal 2.22 compatibility runtime for DTA21269.
 *
 * The kiosk's Android 11 Keymaster HAL dies with DEAD_OBJECT when Stripe 5.7
 * initializes its offline AES key. Stripe 2.22.0 is the first GA WisePad 3 USB
 * release and uses the pre-offline initialization API. This class exists only
 * to prove the physical USB reader/payment path. It must never be promoted as
 * the production SDK baseline.
 */
final class StripeTerminalReaderRuntime implements UsbReaderListener {
    private static final String TAG = "ChargeursStripeV2";
    private static final String PREFS = "stripe_terminal_reader";
    private static final String LAST_READER_ID = "last_reader_id";
    private static final String SDK_COMPAT = "2.22.0-test-only";

    private final Context context;
    private final KioskConfig config;
    private final StripeTerminalBackendClient backend;
    private final SharedPreferences preferences;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicBoolean discoveryRunning = new AtomicBoolean(false);
    private final AtomicBoolean paymentRunning = new AtomicBoolean(false);
    private final AtomicBoolean bindingBootstrapRunning = new AtomicBoolean(false);

    private volatile String readerState = "UNAVAILABLE";
    private volatile String safeErrorCode;
    private volatile String stripeReaderId;
    private volatile String stripeReaderSerial;
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
            if (!discoveryRunning.get() && !paymentRunning.get()) startDiscovery();
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
                "targetVid", "15a2",
                "targetPid", "0101",
                "stripeReaderId", nullableJson(stripeReaderId),
                "stripeReaderSerial", nullableJson(stripeReaderSerial),
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
                if (blankToNull(result.expectedReaderId()) != null) expectedReaderId = result.expectedReaderId();
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
                            localPaymentState = "CONFIRMING";
                            Terminal.getInstance().confirmPaymentIntent(collected, new PaymentIntentCallback() {
                                @Override
                                public void onSuccess(PaymentIntent confirmed) {
                                    activePaymentIntentId = confirmed.getId();
                                    localPaymentState = "SDK_SUCCEEDED";
                                    paymentRailState = "PROCESSING";
                                    paymentRunning.set(false);
                                    readerState = "READY";
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
            Log.e(TAG, "Stripe Terminal 2.22 init failed", error);
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
        if (!discoveryRunning.compareAndSet(false, true)) return;
        readerState = "DISCOVERING";
        safeErrorCode = null;
        DiscoveryConfiguration config = new DiscoveryConfiguration.UsbDiscoveryConfiguration(0, false);
        discoveryCancelable = Terminal.getInstance().discoverReaders(
            config,
            new DiscoveryListener() {
                @Override
                public void onUpdateDiscoveredReaders(List<Reader> readers) {
                    Reader candidate = chooseReader(readers);
                    if (candidate != null) connect(candidate);
                }
            },
            new Callback() {
                @Override
                public void onSuccess() {
                    discoveryCancelable = null;
                    discoveryRunning.set(false);
                    if (Terminal.getInstance().getConnectedReader() == null && usbPresent() && !"CONNECTING".equals(readerState)) {
                        readerState = "ERROR";
                        safeErrorCode = "STRIPE_READER_NOT_DISCOVERED";
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

    private Reader chooseReader(List<Reader> readers) {
        if (readers == null || readers.isEmpty()) return null;
        String expected = blankToNull(expectedReaderId);
        String remembered = preferences.getString(LAST_READER_ID, null);
        if (expected != null) {
            for (Reader reader : readers) if (expected.equals(reader.getId())) return reader;
            return null;
        }
        if (remembered != null) {
            for (Reader reader : readers) {
                if (remembered.equals(reader.getId()) || remembered.equals(reader.getSerialNumber())) return reader;
            }
        }
        return readers.get(0);
    }

    private void connect(Reader reader) {
        if ("CONNECTING".equals(readerState) || "READY".equals(readerState)) return;
        String location = blankToNull(stripeLocationId);
        if (location == null) {
            setError("TERMINAL_LOCATION_BINDING_REQUIRED");
            return;
        }
        readerState = "CONNECTING";
        Terminal.getInstance().connectUsbReader(
            reader,
            new ConnectionConfiguration.UsbConnectionConfiguration(location),
            this,
            new ReaderCallback() {
                @Override
                public void onSuccess(Reader connected) {
                    discoveryRunning.set(false);
                    cancelDiscoverySilently();
                    if (!readerMatchesBinding(connected)) {
                        setError("TERMINAL_READER_BINDING_MISMATCH");
                        return;
                    }
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
        if (blankToNull(stripeReaderId) != null) preferences.edit().putString(LAST_READER_ID, stripeReaderId).apply();
        else if (blankToNull(stripeReaderSerial) != null) preferences.edit().putString(LAST_READER_ID, stripeReaderSerial).apply();
        safeErrorCode = null;
        readerState = paymentRunning.get() ? "BUSY" : "READY";
        Log.i(TAG, "WisePad USB connected through Stripe Terminal 2.22");
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

    private boolean usbPresent() {
        return WisePadUsbProbe.snapshot(context).optBoolean("present", false);
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
        readerState = usbPresent() && Terminal.isInitialized() && Terminal.getInstance().getConnectedReader() != null ? "READY" : "ERROR";
    }

    private void setError(String code) {
        safeErrorCode = code;
        readerState = usbPresent() ? "ERROR" : "ABSENT";
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
    }

    private final class RuntimeTerminalListener implements TerminalListener {
        @Override
        public void onUnexpectedReaderDisconnect(Reader reader) {
            stripeReaderId = null;
            stripeReaderSerial = null;
            readerState = usbPresent() ? "RECONNECTING" : "ABSENT";
            if (usbPresent()) ensureStarted();
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
                    if (!paymentRunning.get()) readerState = usbPresent() ? "DISCOVERING" : "ABSENT";
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
    @Override public void onReportAvailableUpdate(ReaderSoftwareUpdate update) {}
    @Override public void onReportReaderEvent(ReaderEvent event) {}
    @Override public void onReportLowBatteryWarning() {}
    @Override public void onBatteryLevelUpdate(float batteryLevel, BatteryStatus batteryStatus, boolean isCharging) {}
}
