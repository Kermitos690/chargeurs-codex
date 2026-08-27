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

    /**
     * Enrollment origin persisted with the durable kiosk credential.
     *
     * This deliberately remains distinct from the WebView runtime origin so an
     * in-place APK update can keep the existing pairing while the frontend is
     * migrated from Vercel to Cloudflare.
     */
    public String baseUrl() {
        return baseUrl;
    }

    public String kioskUrl() {
        return KioskConfigValidator.kioskUrl(
            KioskConfigValidator.runtimeBaseUrlForEnrollment(baseUrl),
            stationId
        );
    }

    public boolean isValid() {
        return KioskConfigValidator.isValidStationId(stationId)
            && KioskConfigValidator.isValidToken(kioskToken)
            && KioskConfigValidator.normalizeBaseUrl(baseUrl) != null;
    }
}
