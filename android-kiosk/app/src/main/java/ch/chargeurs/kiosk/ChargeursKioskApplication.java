package ch.chargeurs.kiosk;

import android.app.Application;

import com.stripe.stripeterminal.TerminalApplicationDelegate;

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
        TerminalApplicationDelegate.onCreate(this);
    }
}
