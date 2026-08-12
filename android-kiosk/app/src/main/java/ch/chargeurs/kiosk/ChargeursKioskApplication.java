package ch.chargeurs.kiosk;

import android.app.Application;

import com.stripe.stripeterminal.TerminalApplicationDelegate;

/**
 * Application lifecycle owner for Stripe Terminal.
 *
 * Stripe Terminal requires TerminalApplicationDelegate.onCreate() to be called
 * from the process Application. This does not initialize payments or connect a
 * reader by itself; it only wires the SDK lifecycle into the dedicated kiosk
 * process. USB discovery/connection remains TEST-only behind BuildConfig.
 */
public final class ChargeursKioskApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        TerminalApplicationDelegate.onCreate(this);
    }
}
