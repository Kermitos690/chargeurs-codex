package ch.chargeurs.kiosk;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

import javax.net.ssl.HttpsURLConnection;

/** HTTPS-only verifier for the local operator maintenance gate. */
final class OperatorUnlockClient {
    private static final int MAX_RESPONSE_BYTES = 16 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 8_000;
    private static final int READ_TIMEOUT_MS = 10_000;
    private static final String ENROLLMENT_SUFFIX = "/functions/v1/kiosk-enroll";
    private static final String OPERATOR_SUFFIX = "/functions/v1/kiosk-operator-unlock";

    private OperatorUnlockClient() {}

    static void verify(
        String enrollmentEndpoint,
        String pin,
        String devicePublicId,
        String appVersion
    ) throws Exception {
        String endpoint = operatorEndpoint(enrollmentEndpoint);
        if (endpoint == null) throw new IllegalArgumentException("OPERATOR_ACCESS_NOT_CONFIGURED");
        if (!isValidPin(pin) || !isValidDevicePublicId(devicePublicId)) {
            throw new IllegalArgumentException("INVALID_OPERATOR_REQUEST");
        }
        String version = appVersion == null ? "" : appVersion.trim();
        if (version.isEmpty() || version.length() > 64) {
            throw new IllegalArgumentException("INVALID_OPERATOR_REQUEST");
        }

        HttpsURLConnection connection = (HttpsURLConnection) new URL(endpoint).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestMethod("POST");
        connection.setInstanceFollowRedirects(false);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Cache-Control", "no-store");

        JSONObject request = new JSONObject()
            .put("pin", pin)
            .put("devicePublicId", devicePublicId)
            .put("appVersion", version);
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
            JSONObject json = response.trim().isEmpty() ? new JSONObject() : new JSONObject(response);
            String serverError = json.optString("error", "").trim();
            if (status != 200 || !json.optBoolean("ok", false)) {
                throw new IllegalStateException(serverError.isEmpty() ? "OPERATOR_ACCESS_REJECTED" : serverError);
            }
        } finally {
            connection.disconnect();
        }
    }

    static String operatorEndpoint(String enrollmentEndpoint) {
        String normalized = KioskConfigValidator.normalizeHttpsEndpoint(enrollmentEndpoint);
        if (normalized == null || !normalized.endsWith(ENROLLMENT_SUFFIX)) return null;
        return normalized.substring(0, normalized.length() - ENROLLMENT_SUFFIX.length()) + OPERATOR_SUFFIX;
    }

    static boolean isValidPin(String pin) {
        return pin != null && pin.matches("^\\d{6}$");
    }

    static boolean isValidDevicePublicId(String value) {
        if (value == null) return false;
        try {
            return UUID.fromString(value).version() == 4;
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    private static String readLimited(InputStream input) throws Exception {
        if (input == null) return "";
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[2048];
            int total = 0;
            int count;
            while ((count = source.read(buffer)) != -1) {
                total += count;
                if (total > MAX_RESPONSE_BYTES) throw new IllegalStateException("OPERATOR_RESPONSE_TOO_LARGE");
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
}
