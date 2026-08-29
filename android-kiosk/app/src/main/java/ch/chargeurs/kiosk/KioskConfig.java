package ch.chargeurs.kiosk;

public final class KioskConfig {
    private final String stationId;
    private final String kioskToken;
    private final String baseUrl;

    public KioskConfig(String stationId, String kioskToken, String baseUrl) {
        this.stationId = stationId;
        this.kioskToken = kioskToken;
        this.baseUrl = baseUrl;
    }

    public String stationId() {
        return stationId;
    }

    public String kioskToken() {
        return kioskToken;
    }

    /** Durable enrollment origin returned by kiosk-enroll. */
    public String baseUrl() {
        return baseUrl;
    }

    /**
     * Runtime WebView URL. The encrypted enrollment origin is intentionally
     * preserved so an APK upgrade can reuse the existing kiosk credential while
     * the web application moves to a separately pinned Cloudflare origin.
     */
    public String kioskUrl() {
        String runtimeBaseUrl = KioskConfigValidator.resolveRuntimeBaseUrl(
            baseUrl,
            BuildConfig.KIOSK_PUBLIC_BASE_URL,
            BuildConfig.KIOSK_WEB_BASE_URL
        );
        if (runtimeBaseUrl == null) {
            throw new IllegalArgumentException("INVALID_KIOSK_RUNTIME_CONFIGURATION");
        }
        return KioskConfigValidator.kioskUrl(runtimeBaseUrl, stationId);
    }

    public boolean isValid() {
        return KioskConfigValidator.isValidStationId(stationId)
            && KioskConfigValidator.isValidToken(kioskToken)
            && KioskConfigValidator.normalizeBaseUrl(baseUrl) != null;
    }
}
