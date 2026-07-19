package ch.chargeurs.kiosk;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.HttpsURLConnection;

public final class EnrollmentClient {
    private static final int MAX_RESPONSE_BYTES = 64 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 15_000;

    private EnrollmentClient() {}

    public static EnrollmentResult enroll(
        String endpoint,
        String pairingCode,
        String devicePublicId,
        String appVersion
    ) throws Exception {
        String normalizedEndpoint = KioskConfigValidator.normalizeHttpsEndpoint(endpoint);
        if (normalizedEndpoint == null) throw new IllegalArgumentException("ENROLLMENT_NOT_CONFIGURED");
        if (pairingCode == null || !pairingCode.matches("^kc_[A-Za-z0-9_-]{16,64}$")) {
            throw new IllegalArgumentException("INVALID_PAIRING_CODE");
        }

        HttpsURLConnection connection = (HttpsURLConnection) new URL(normalizedEndpoint).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestMethod("POST");
        connection.setInstanceFollowRedirects(false);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Cache-Control", "no-store");

        JSONObject request = new JSONObject()
            .put("pairingCode", pairingCode)
            .put("devicePublicId", devicePublicId)
            .put("appVersion", appVersion);
        byte[] requestBytes = request.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(requestBytes.length);

        try {
            try (OutputStream output = connection.getOutputStream()) {
                output.write(requestBytes);
            }
            int status = connection.getResponseCode();
            InputStream body = status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
            String response = readLimited(body);
            if (status != 200) throw new IllegalStateException("ENROLLMENT_REJECTED");

            JSONObject json = new JSONObject(response);
            if (!json.optBoolean("ok", false)) throw new IllegalStateException("ENROLLMENT_REJECTED");
            String stationId = json.optString("stationId", "");
            String kioskToken = json.optString("kioskToken", "");
            String baseUrl = json.optString("baseUrl", "");
            String deviceId = json.optString("deviceId", "");
            KioskConfig config = new KioskConfig(stationId, kioskToken, baseUrl);
            if (!config.isValid() || deviceId.trim().isEmpty()) throw new IllegalStateException("INVALID_ENROLLMENT_RESPONSE");
            return new EnrollmentResult(deviceId, config);
        } finally {
            connection.disconnect();
        }
    }

    private static String readLimited(InputStream input) throws Exception {
        if (input == null) return "";
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int total = 0;
            int count;
            while ((count = source.read(buffer)) != -1) {
                total += count;
                if (total > MAX_RESPONSE_BYTES) throw new IllegalStateException("ENROLLMENT_RESPONSE_TOO_LARGE");
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
}
