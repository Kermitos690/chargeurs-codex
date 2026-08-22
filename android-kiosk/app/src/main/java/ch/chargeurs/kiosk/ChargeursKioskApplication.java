package ch.chargeurs.kiosk;

import android.app.Application;
import android.util.Log;

import com.stripe.stripeterminal.TerminalApplicationDelegate;

import java.util.Locale;

import io.reactivex.rxjava3.plugins.RxJavaPlugins;

/**
 * Process owner for the TEST-only Stripe Terminal USB runtime.
 *
 * Calling TerminalApplicationDelegate.onCreate wires Stripe's Android lifecycle
 * before MainActivity creates the WebView bridge. It does not connect a reader,
 * create a PaymentIntent, or perform any payment by itself.
 */
public final class ChargeursKioskApplication extends Application {
    private static final String TAG = "ChargeursStripeV2";
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
        // Stripe 3.0.0 can publish this particular offline-cache decryption
        // error after the connection callback has already failed. RxJava then
        // treats it as undeliverable and kills the kiosk process. Keep the
        // reader in its explicit ERROR/retry path instead. Every other RxJava
        // error is delegated to the platform's uncaught-exception handler.
        RxJavaPlugins.setErrorHandler(error -> {
            if (isRecoverableStripeOfflineCacheError(error)) {
                Log.e(TAG, "Stripe offline credential cache needs explicit reader repair", error);
                return;
            }
            Thread.UncaughtExceptionHandler handler = Thread.currentThread().getUncaughtExceptionHandler();
            if (handler != null) handler.uncaughtException(Thread.currentThread(), error);
        });
        TerminalApplicationDelegate.onCreate(this);
    }

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
