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

    public String baseUrl() {
        return baseUrl;
    }

    public String kioskUrl() {
        return KioskConfigValidator.kioskUrl(baseUrl, stationId);
    }

    public boolean isValid() {
        return KioskConfigValidator.isValidStationId(stationId)
            && KioskConfigValidator.isValidToken(kioskToken)
            && KioskConfigValidator.normalizeBaseUrl(baseUrl) != null;
    }
}
