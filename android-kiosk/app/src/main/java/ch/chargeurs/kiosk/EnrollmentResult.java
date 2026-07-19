package ch.chargeurs.kiosk;

public final class EnrollmentResult {
    private final String deviceId;
    private final KioskConfig config;

    public EnrollmentResult(String deviceId, KioskConfig config) {
        this.deviceId = deviceId;
        this.config = config;
    }

    public String deviceId() {
        return deviceId;
    }

    public KioskConfig config() {
        return config;
    }
}
