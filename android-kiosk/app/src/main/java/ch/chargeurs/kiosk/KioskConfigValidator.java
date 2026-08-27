package ch.chargeurs.kiosk;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.regex.Pattern;

public final class KioskConfigValidator {
    private static final Pattern STATION = Pattern.compile("^[A-Za-z0-9_-]{4,32}$");
    private static final Pattern TOKEN = Pattern.compile("^[A-Za-z0-9._~-]{16,512}$");

    private KioskConfigValidator() {}

    public static boolean isValidStationId(String value) {
        return value != null && STATION.matcher(value.trim()).matches();
    }

    public static boolean isValidToken(String value) {
        return value != null && TOKEN.matcher(value.trim()).matches();
    }

    public static String normalizeBaseUrl(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.endsWith("/")) trimmed = trimmed.substring(0, trimmed.length() - 1);
        try {
            URI uri = new URI(trimmed);
            if (!"https".equalsIgnoreCase(uri.getScheme())) return null;
            if (uri.getHost() == null || uri.getHost().trim().isEmpty()) return null;
            if (uri.getUserInfo() != null || uri.getFragment() != null || uri.getQuery() != null) return null;
            String path = uri.getPath();
            if (path != null && !path.trim().isEmpty() && !"/".equals(path)) return null;
            int port = uri.getPort();
            if (port != -1 && port != 443) return null;
            return "https://" + uri.getHost().toLowerCase(Locale.ROOT) + (port == 443 ? ":443" : "");
        } catch (URISyntaxException exception) {
            return null;
        }
    }

    public static String normalizeHttpsEndpoint(String value) {
        if (value == null) return null;
        try {
            URI uri = new URI(value.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme())) return null;
            if (uri.getHost() == null || uri.getHost().trim().isEmpty()) return null;
            if (uri.getUserInfo() != null || uri.getFragment() != null || uri.getQuery() != null) return null;
            int port = uri.getPort();
            if (port != -1 && port != 443) return null;
            String path = uri.getRawPath();
            if (path == null || path.trim().isEmpty() || "/".equals(path)) return null;
            return uri.toASCIIString();
        } catch (URISyntaxException exception) {
            return null;
        }
    }

    /**
     * Resolves the origin used by the WebView without changing the origin that
     * was signed into the device enrollment. The override is honored only for
     * a configuration that still matches the APK's pinned enrollment origin.
     * A non-empty but invalid override fails closed instead of falling back.
     */
    public static String runtimeBaseUrl(
        String enrolledBaseUrl,
        String pinnedEnrollmentBaseUrl,
        String webBaseUrl
    ) {
        String normalizedEnrolled = normalizeBaseUrl(enrolledBaseUrl);
        if (normalizedEnrolled == null) return null;
        if (!matchesPinnedBaseUrl(normalizedEnrolled, pinnedEnrollmentBaseUrl)) {
            return normalizedEnrolled;
        }
        if (webBaseUrl == null || webBaseUrl.trim().isEmpty()) {
            return normalizedEnrolled;
        }
        return normalizeBaseUrl(webBaseUrl);
    }

    public static boolean isAllowedUrl(String candidate, String baseUrl) {
        return isAllowedUrl(
            candidate,
            baseUrl,
            BuildConfig.KIOSK_PUBLIC_BASE_URL,
            BuildConfig.KIOSK_WEB_BASE_URL
        );
    }

    static boolean isAllowedUrl(
        String candidate,
        String enrolledBaseUrl,
        String pinnedEnrollmentBaseUrl,
        String webBaseUrl
    ) {
        String normalizedBase = runtimeBaseUrl(
            enrolledBaseUrl,
            pinnedEnrollmentBaseUrl,
            webBaseUrl
        );
        if (candidate == null || normalizedBase == null) return false;
        try {
            URI candidateUri = new URI(candidate);
            URI baseUri = new URI(normalizedBase);
            return "https".equalsIgnoreCase(candidateUri.getScheme())
                && candidateUri.getHost() != null
                && candidateUri.getHost().equalsIgnoreCase(baseUri.getHost())
                && effectivePort(candidateUri) == effectivePort(baseUri)
                && candidateUri.getUserInfo() == null;
        } catch (URISyntaxException exception) {
            return false;
        }
    }

    public static boolean matchesPinnedBaseUrl(String candidate, String pinnedBaseUrl) {
        String normalizedCandidate = normalizeBaseUrl(candidate);
        String normalizedPinned = normalizeBaseUrl(pinnedBaseUrl);
        return normalizedCandidate != null
            && normalizedPinned != null
            && normalizedCandidate.equals(normalizedPinned);
    }

    public static String kioskUrl(String baseUrl, String stationId) {
        String normalizedBase = normalizeBaseUrl(baseUrl);
        if (normalizedBase == null || !isValidStationId(stationId)) {
            throw new IllegalArgumentException("INVALID_KIOSK_CONFIGURATION");
        }
        return normalizedBase + "/kiosk/" + stationId.trim();
    }

    private static int effectivePort(URI uri) {
        return uri.getPort() == -1 ? 443 : uri.getPort();
    }
}
