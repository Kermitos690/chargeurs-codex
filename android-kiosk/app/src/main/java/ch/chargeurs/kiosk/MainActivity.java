package ch.chargeurs.kiosk;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

@SuppressLint("ObsoleteSdkInt")
public final class MainActivity extends Activity {
    private static final long WATCHDOG_INTERVAL_MS = 30_000L;
    private static final long WATCHDOG_TIMEOUT_MS = 15_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private FrameLayout container;
    private WebView webView;
    private ProgressBar progress;
    private TextView networkBanner;
    private View splashBrand;
    private KioskConfig config;
    private boolean credentialsInjected;
    private boolean heartbeatPending;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private CabinetController cabinetController;

    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            if (webView != null && webView.getVisibility() == View.VISIBLE && isNetworkAvailable()) {
                heartbeatPending = true;
                webView.evaluateJavascript("(function(){return 'chargeurs-ok';})()", value -> heartbeatPending = false);
                handler.postDelayed(() -> {
                    if (heartbeatPending && !isFinishing()) recreateWebView();
                }, WATCHDOG_TIMEOUT_MS);
            }
            handler.postDelayed(this, WATCHDOG_INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        SecureConfigStore configStore = new SecureConfigStore(this);
        config = configStore.load();
        if (config == null || !KioskConfigValidator.matchesPinnedBaseUrl(
            config.baseUrl(), BuildConfig.KIOSK_PUBLIC_BASE_URL
        )) {
            if (config != null) configStore.clear();
            startActivity(new Intent(this, ProvisioningActivity.class));
            finish();
            return;
        }

        cabinetController = new CabinetController(
            new AndroidSerialHardwareTransport(this),
            new UnconfiguredCabinetProtocolAdapter()
        );

        KioskVisuals.applyKioskWindow(this);
        registerBackBlocking();
        setContentView(buildRoot());
        registerConnectivityMonitoring();
        createWebView();
        handler.postDelayed(watchdog, WATCHDOG_INTERVAL_MS);
    }

    private FrameLayout buildRoot() {
        container = new FrameLayout(this);
        container.addView(new KioskAmbientBackground(this), new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ));

        TextView splash = KioskVisuals.brandText(this, 30);
        splash.setGravity(Gravity.CENTER);
        splash.setText(R.string.splash_connecting);
        splash.setLineSpacing(dp(8), 1f);
        splashBrand = splash;
        FrameLayout.LayoutParams splashParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        splashParams.gravity = Gravity.CENTER;
        container.addView(splash, splashParams);
        KioskVisuals.fadeIn(splash);

        progress = new ProgressBar(this);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(dp(56), dp(56));
        progressParams.gravity = Gravity.CENTER;
        container.addView(progress, progressParams);

        networkBanner = new TextView(this);
        networkBanner.setText(R.string.network_unavailable);
        networkBanner.setTextColor(Color.WHITE);
        networkBanner.setTextSize(15);
        networkBanner.setGravity(Gravity.CENTER);
        networkBanner.setBackgroundColor(Color.rgb(181, 59, 52));
        networkBanner.setPadding(dp(12), dp(8), dp(12), dp(8));
        networkBanner.setVisibility(View.GONE);
        FrameLayout.LayoutParams bannerParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        bannerParams.gravity = Gravity.TOP;
        container.addView(networkBanner, bannerParams);
        return container;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        if (container == null || isFinishing()) return;

        try {
            webView = new WebView(this);
        } catch (RuntimeException error) {
            // Some industrial Android images ship without a usable System
            // WebView (or have it disabled). Keep the kiosk process alive and
            // show a safe, actionable diagnostic instead of closing abruptly.
            showStartupError("WEBVIEW_UNAVAILABLE", error);
            return;
        }
        webView.setBackgroundColor(Color.rgb(8, 17, 38));
        webView.setVisibility(View.INVISIBLE);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setAllowFileAccessFromFileURLs(false);
        webView.getSettings().setAllowUniversalAccessFromFileURLs(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.getSettings().setGeolocationEnabled(false);
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        webView.getSettings().setSupportMultipleWindows(false);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(true);
        webView.getSettings().setSaveFormData(false);
        webView.getSettings().setUserAgentString(
            webView.getSettings().getUserAgentString()
                + " ChargeursKiosk/"
                + BuildConfig.VERSION_NAME
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.getSettings().setSafeBrowsingEnabled(true);
        }
        try {
            webView.addJavascriptInterface(new NativeBridge(this, config, cabinetController), "ChargeursNative");
        } catch (RuntimeException error) {
            showStartupError("NATIVE_BRIDGE_UNAVAILABLE", error);
            return;
        }

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
            Toast.makeText(this, R.string.download_blocked, Toast.LENGTH_SHORT).show()
        );

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setVisibility(newProgress < 100 || !credentialsInjected ? View.VISIBLE : View.GONE);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(
                String origin,
                GeolocationPermissions.Callback callback
            ) {
                callback.invoke(origin, false, false);
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !KioskConfigValidator.isAllowedUrl(request.getUrl().toString(), config.baseUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!KioskConfigValidator.isAllowedUrl(url, config.baseUrl())) {
                    showBlockedNavigation();
                    return;
                }

                if (!credentialsInjected) {
                    injectCredentialsAndReload(view);
                    return;
                }

                progress.setVisibility(View.GONE);
                webView.setVisibility(View.VISIBLE);
                if (splashBrand != null) splashBrand.animate().alpha(0f).setDuration(220L).withEndAction(
                    () -> splashBrand.setVisibility(View.GONE)
                ).start();
                heartbeatPending = false;
            }

            @Override
            public void onReceivedSslError(
                WebView view,
                SslErrorHandler handler,
                SslError error
            ) {
                handler.cancel();
                showBlockedNavigation();
            }

            @Override
            public void onReceivedError(
                WebView view,
                WebResourceRequest request,
                WebResourceError error
            ) {
                if (request.isForMainFrame()) {
                    networkBanner.setVisibility(View.VISIBLE);
                    progress.setVisibility(View.VISIBLE);
                }
            }
        });

        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        container.addView(webView, 0, webParams);
        try {
            webView.loadUrl(config.kioskUrl());
        } catch (RuntimeException error) {
            showStartupError("WEBVIEW_LOAD_FAILED", error);
        }
    }

    private void showStartupError(String code, Throwable error) {
        if (isFinishing()) return;
        if (webView != null) {
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) parent.removeView(webView);
            webView.destroy();
            webView = null;
        }
        if (progress != null) progress.setVisibility(View.GONE);
        TextView diagnostic = new TextView(this);
        diagnostic.setText(getString(
            R.string.startup_error,
            code,
            error.getClass().getSimpleName()
        ));
        diagnostic.setTextColor(KioskVisuals.WHITE);
        diagnostic.setTextSize(18);
        diagnostic.setGravity(Gravity.CENTER);
        diagnostic.setPadding(dp(28), dp(28), dp(28), dp(28));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        container.addView(diagnostic, params);
    }

    private void injectCredentialsAndReload(WebView view) {
        String script = "(function(){"
            + "localStorage.setItem('kiosk_locked_station'," + JSONObject.quote(config.stationId()) + ");"
            + "localStorage.removeItem('kiosk_token');"
            + "sessionStorage.setItem('kiosk_token'," + JSONObject.quote(config.kioskToken()) + ");"
            + "localStorage.setItem('chargeurs_native_wrapper'," + JSONObject.quote(BuildConfig.VERSION_NAME) + ");"
            + "return true;})()";
        view.evaluateJavascript(script, result -> {
            credentialsInjected = true;
            view.loadUrl(config.kioskUrl());
        });
    }

    private void recreateWebView() {
        heartbeatPending = false;
        credentialsInjected = false;
        if (webView != null) {
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) parent.removeView(webView);
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.clearHistory();
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        progress.setVisibility(View.VISIBLE);
        if (splashBrand != null) {
            splashBrand.setVisibility(View.VISIBLE);
            KioskVisuals.fadeIn(splashBrand);
        }
        handler.postDelayed(this::createWebView, 750L);
    }

    private void showBlockedNavigation() {
        if (isFinishing()) return;
        new AlertDialog.Builder(this)
            .setTitle(R.string.navigation_blocked_title)
            .setMessage(R.string.navigation_blocked_message)
            .setCancelable(false)
            .setPositiveButton(R.string.reload, (dialog, which) -> recreateWebView())
            .show();
    }

    void showNativeDiagnostics(JSONObject hardwareStatus) {
        runOnUiThread(() -> new AlertDialog.Builder(this)
            .setTitle(R.string.diagnostics_title)
            .setMessage(JsonObjects.of(
                "appVersion", BuildConfig.VERSION_NAME,
                "stationId", config.stationId(),
                "deviceId", DeviceIdentity.getOrCreate(this),
                "hardware", hardwareStatus
            ).toString())
            .setPositiveButton(R.string.diagnostics_close, null)
            .show());
    }

    void restartKioskRuntime() {
        runOnUiThread(this::recreateWebView);
    }

    private void registerConnectivityMonitoring() {
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(() -> networkBanner.setVisibility(View.GONE));
            }

            @Override
            public void onLost(Network network) {
                runOnUiThread(() -> networkBanner.setVisibility(View.VISIBLE));
            }
        };

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                connectivityManager.registerDefaultNetworkCallback(networkCallback);
            } else {
                NetworkRequest request = new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build();
                connectivityManager.registerNetworkCallback(request, networkCallback);
            }
        } catch (RuntimeException ignored) {
            networkBanner.setVisibility(isNetworkAvailable() ? View.GONE : View.VISIBLE);
        }
    }

    private boolean isNetworkAvailable() {
        if (connectivityManager == null) return false;
        Network active = connectivityManager.getActiveNetwork();
        if (active == null) return false;
        NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(active);
        return capabilities != null
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    @Override
    protected void onResume() {
        super.onResume();
        KioskVisuals.applyKioskWindow(this);
        DevicePolicyManager policy = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
        KeyguardManager keyguard = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (policy != null
            && keyguard != null
            && !keyguard.isKeyguardLocked()
            && policy.isLockTaskPermitted(getPackageName())) {
            try {
                startLockTask();
            } catch (IllegalStateException ignored) {
                // The device policy controller decides whether true lock-task mode is available.
            }
        }
    }

    private void registerBackBlocking() {
        // onBackPressed() below covers legacy Android. On Android 13+, the
        // dedicated-device lock-task policy is the authoritative back guard;
        // avoiding a direct OnBackInvokedDispatcher reference keeps this APK
        // loadable on older tablet firmware.
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
                // Already unregistered.
            }
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    @SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Legacy back button is disabled on Android 12 and earlier. Android 13+
        // uses the registered OnBackInvoked callback above.
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
