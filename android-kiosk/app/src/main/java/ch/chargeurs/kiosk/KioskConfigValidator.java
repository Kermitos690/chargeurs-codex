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
     * Resolve the WebView runtime origin without changing the durable enrollment
     * origin stored in SecureConfigStore.
     *
     * Only the build-pinned enrollment origin is eligible for the separate
     * KIOSK_WEB_BASE_URL. Arbitrary configs used by tests or diagnostics retain
     * their own origin. A non-empty but invalid compiled runtime URL fails
     * closed instead of silently broadening navigation.
     */
    static String runtimeBaseUrlForEnrollment(String enrollmentBaseUrl) {
        String normalizedEnrollment = normalizeBaseUrl(enrollmentBaseUrl);
        if (normalizedEnrollment == null) {
            throw new IllegalArgumentException("INVALID_KIOSK_ENROLLMENT_BASE_URL");
        }

        String pinnedRaw = BuildConfig.KIOSK_PUBLIC_BASE_URL == null
            ? ""
            : BuildConfig.KIOSK_PUBLIC_BASE_URL.trim();
        if (pinnedRaw.isEmpty()) return normalizedEnrollment;

        String normalizedPinned = normalizeBaseUrl(pinnedRaw);
        if (normalizedPinned == null) {
            throw new IllegalArgumentException("INVALID_KIOSK_PINNED_BASE_URL");
        }
        if (!normalizedEnrollment.equals(normalizedPinned)) return normalizedEnrollment;

        String runtimeRaw = BuildConfig.KIOSK_WEB_BASE_URL == null
            ? ""
            : BuildConfig.KIOSK_WEB_BASE_URL.trim();
        if (runtimeRaw.isEmpty()) return normalizedEnrollment;

        String normalizedRuntime = normalizeBaseUrl(runtimeRaw);
        if (normalizedRuntime == null) {
            throw new IllegalArgumentException("INVALID_KIOSK_WEB_BASE_URL");
        }
        return normalizedRuntime;
    }

    public static boolean isAllowedUrl(String candidate, String baseUrl) {
        final String normalizedBase;
        try {
            normalizedBase = runtimeBaseUrlForEnrollment(baseUrl);
        } catch (IllegalArgumentException error) {
            return false;
        }
        if (candidate == null) return false;
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
