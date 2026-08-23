package ch.chargeurs.kiosk;

import android.app.Application;

import com.stripe.stripeterminal.TerminalApplicationDelegate;

import java.util.Locale;

/**
 * Process owner for the TEST-only Stripe Terminal USB runtime.
 *
 * Calling TerminalApplicationDelegate.onCreate wires Stripe's Android lifecycle
 * before MainActivity creates the WebView bridge. It does not connect a reader,
 * create a PaymentIntent, or perform any payment by itself.
 */
public final class ChargeursKioskApplication extends Application {
    private StripeTerminalReaderRuntime terminalRuntime;

    synchronized StripeTerminalReaderRuntime terminalRuntime(KioskConfig config) {
        if (terminalRuntime == null || !terminalRuntime.matchesStation(config.stationId())) {
            terminalRuntime = new StripeTerminalReaderRuntime(getApplicationContext(), config);
        }
        return terminalRuntime;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        // Stripe Terminal 5.7.0 owns its reader/offline lifecycle internally.
        // Do not install the old 3.0.0 global RxJava undeliverable-error hook:
        // carrying that process-wide workaround forward could mask unrelated
        // failures in the newer SDK. Reader recovery is handled explicitly by
        // StripeTerminalReaderRuntime and MobileReaderListener instead.
        TerminalApplicationDelegate.onCreate(this);
    }

    /**
     * Retained as a pure regression helper for the historical 3.0.0 failure.
     * It is deliberately not registered as a process-wide exception handler in
     * the 5.7.0 field build.
     */
    static boolean isRecoverableStripeOfflineCacheError(Throwable error) {
        for (Throwable current = error; current != null; current = current.getCause()) {
            String type = current.getClass().getName().toLowerCase(Locale.ROOT);
            String message = String.valueOf(current.getMessage()).toLowerCase(Locale.ROOT);
            if (type.contains("offlinedecryptionexception")
                || (message.contains("offlinedecryptionexception") && message.contains("offline_location"))) {
                return true;
            }
        }
        return false;
    }
}
