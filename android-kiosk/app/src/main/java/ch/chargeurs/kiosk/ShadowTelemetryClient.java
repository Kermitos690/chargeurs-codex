package ch.chargeurs.kiosk;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.HttpsURLConnection;

/**
 * Sends read-only local observations to the Chargeurs.ch backend while
 * ChargeNow remains the active gateway. No ChargeNow credential, cookie or
 * payload is accepted by this client.
 */
public final class ShadowTelemetryClient {
    private static final int MAX_RESPONSE_BYTES = 64 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 20_000;
    private static final String FUNCTIONS_MARKER = "/functions/v1/";

    private ShadowTelemetryClient() {}

    public static String deriveEndpoint(String enrollmentEndpoint) {
        String normalized = KioskConfigValidator.normalizeHttpsEndpoint(enrollmentEndpoint);
        if (normalized == null) return null;
        int marker = normalized.indexOf(FUNCTIONS_MARKER);
        if (marker < 0) return null;
        String endpoint = normalized.substring(0, marker + FUNCTIONS_MARKER.length())
            + "device-shadow-ingest";
        return KioskConfigValidator.normalizeHttpsEndpoint(endpoint);
    }

    public static JSONObject upload(
        String endpoint,
        KioskConfig config,
        String devicePublicId,
        String appVersion,
        long sequence,
        JSONObject report
    ) throws Exception {
        String normalizedEndpoint = KioskConfigValidator.normalizeHttpsEndpoint(endpoint);
        if (normalizedEndpoint == null) throw new IllegalArgumentException("SHADOW_ENDPOINT_NOT_CONFIGURED");
        if (config == null || !config.isValid()) throw new IllegalArgumentException("KIOSK_NOT_PROVISIONED");
        if (devicePublicId == null || devicePublicId.trim().length() < 8) {
            throw new IllegalArgumentException("INVALID_DEVICE_ID");
        }
        if (report == null) throw new IllegalArgumentException("INVALID_REPORT");

        JSONObject request = new JSONObject()
            .put("stationId", config.stationId())
            .put("devicePublicId", devicePublicId)
            .put("appVersion", appVersion)
            .put("sequence", sequence)
            .put("mode", "shadow")
            .put("report", report);
        byte[] requestBytes = request.toString().getBytes(StandardCharsets.UTF_8);

        HttpsURLConnection connection = (HttpsURLConnection) new URL(normalizedEndpoint).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestMethod("POST");
        connection.setInstanceFollowRedirects(false);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Cache-Control", "no-store");
        connection.setRequestProperty("X-Kiosk-Token", config.kioskToken());
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
            JSONObject json = response.trim().isEmpty() ? new JSONObject() : new JSONObject(response);
            String serverError = json.optString("error", "").trim();
            if (status < 200 || status >= 300 || !json.optBoolean("ok", false)) {
                throw new IllegalStateException(serverError.isEmpty() ? "HTTP_" + status : serverError);
            }
            return json;
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
                if (total > MAX_RESPONSE_BYTES) {
                    throw new IllegalStateException("SHADOW_RESPONSE_TOO_LARGE");
                }
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
}
