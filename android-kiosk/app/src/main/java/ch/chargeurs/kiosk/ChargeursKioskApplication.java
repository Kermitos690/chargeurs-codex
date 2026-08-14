package ch.chargeurs.kiosk;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;

import com.stripe.stripeterminal.TerminalApplicationDelegate;

/**
 * Application lifecycle owner for Stripe Terminal and the local kiosk recovery
 * entry point.
 *
 * Stripe Terminal requires TerminalApplicationDelegate.onCreate() to be called
 * from the process Application. This does not initialize payments or connect a
 * reader by itself; it only wires the SDK lifecycle into the dedicated kiosk
 * process. Physical USB and simulated-reader lanes remain TEST-only behind
 * BuildConfig and are intentionally distinct runtimes.
 */
public final class ChargeursKioskApplication extends Application {
    private StripeTerminalReaderRuntime terminalRuntime;
    private StripeTerminalSimulatedRuntime simulatedRuntime;

    synchronized StripeTerminalReaderRuntime terminalRuntime(KioskConfig config) {
        if (terminalRuntime == null || !terminalRuntime.matchesStation(config.stationId())) {
            terminalRuntime = new StripeTerminalReaderRuntime(getApplicationContext(), config);
        }
        return terminalRuntime;
    }

    synchronized StripeTerminalSimulatedRuntime simulatedTerminalRuntime(KioskConfig config) {
        if (simulatedRuntime == null || !simulatedRuntime.matchesStation(config.stationId())) {
            simulatedRuntime = new StripeTerminalSimulatedRuntime(getApplicationContext(), config);
        }
        return simulatedRuntime;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        TerminalApplicationDelegate.onCreate(this);
        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override public void onActivityCreated(Activity activity, Bundle state) { }
            @Override public void onActivityStarted(Activity activity) { }

            @Override
            public void onActivityResumed(Activity activity) {
                // Install after the Activity has built its visible hierarchy so
                // the 5-tap hotspot remains the top native layer even when the
                // WebView, Ads, auth guard or zero-config cover is degraded.
                if (activity instanceof MainActivity || activity instanceof ProvisioningActivity) {
                    OperatorAccessGate.install(activity);
                }
            }

            @Override public void onActivityPaused(Activity activity) { }
            @Override public void onActivityStopped(Activity activity) { }
            @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) { }
            @Override public void onActivityDestroyed(Activity activity) { }
        });
    }
}
