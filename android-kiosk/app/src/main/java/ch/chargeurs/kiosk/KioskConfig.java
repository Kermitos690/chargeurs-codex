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

    /** Enrollment origin persisted with the encrypted kiosk credential. */
    public String baseUrl() {
        return baseUrl;
    }

    /**
     * Runtime WebView origin. During the Vercel -> Cloudflare migration this
     * may differ from the enrollment origin without changing or reissuing the
     * stored bearer token.
     */
    public String runtimeBaseUrl() {
        return KioskConfigValidator.runtimeBaseUrl(
            baseUrl,
            BuildConfig.KIOSK_PUBLIC_BASE_URL,
            BuildConfig.KIOSK_WEB_BASE_URL
        );
    }

    public String kioskUrl() {
        return KioskConfigValidator.kioskUrl(runtimeBaseUrl(), stationId);
    }

    public boolean isValid() {
        return KioskConfigValidator.isValidStationId(stationId)
            && KioskConfigValidator.isValidToken(kioskToken)
            && KioskConfigValidator.normalizeBaseUrl(baseUrl) != null;
    }
}
