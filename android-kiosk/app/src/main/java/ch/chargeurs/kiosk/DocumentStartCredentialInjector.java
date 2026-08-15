package ch.chargeurs.kiosk;

import android.net.Uri;
import android.webkit.WebView;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.util.Collections;
import java.util.Set;

/**
 * Installs the kiosk credential at document start, before any application
 * JavaScript can issue a protected request. The script is origin-restricted to
 * the enrolled Chargeurs.ch base URL and the token is never written to logs or
 * persistent WebView storage.
 */
final class DocumentStartCredentialInjector {
    private DocumentStartCredentialInjector() {}

    static boolean install(WebView webView, KioskConfig config, String appVersion) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return false;
        try {
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                script(config.stationId(), config.kioskToken(), appVersion),
                allowedOrigins(config.baseUrl())
            );
            return true;
        } catch (IllegalArgumentException | UnsupportedOperationException | RuntimeException error) {
            // Legacy industrial WebViews keep the existing two-load fallback in
            // MainActivity. No credential is exposed if document-start support
            // is unavailable or rejected by the vendor WebView.
            return false;
        }
    }

    static String script(String stationId, String kioskToken, String appVersion) {
        return "(function(){"
            + "localStorage.setItem('kiosk_locked_station'," + JSONObject.quote(stationId) + ");"
            + "localStorage.removeItem('kiosk_token');"
            + "sessionStorage.setItem('kiosk_token'," + JSONObject.quote(kioskToken) + ");"
            + "localStorage.setItem('chargeurs_native_wrapper'," + JSONObject.quote(appVersion) + ");"
            + "document.documentElement.dataset.kioskNativeAuth='document-start';"
            + "})();";
    }

    static Set<String> allowedOrigins(String baseUrl) {
        String normalized = KioskConfigValidator.normalizeBaseUrl(baseUrl);
        if (normalized == null) throw new IllegalArgumentException("INVALID_KIOSK_BASE_URL");
        Uri uri = Uri.parse(normalized);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) throw new IllegalArgumentException("INVALID_KIOSK_BASE_URL");
        StringBuilder origin = new StringBuilder(scheme).append("://").append(host);
        if (uri.getPort() >= 0) origin.append(':').append(uri.getPort());
        return Collections.singleton(origin.toString());
    }
}
