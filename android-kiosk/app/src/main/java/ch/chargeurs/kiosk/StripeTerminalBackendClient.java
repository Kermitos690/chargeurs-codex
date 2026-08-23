package ch.chargeurs.kiosk;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Minimal TEST-only transport to the canonical Stripe Terminal backend.
 * Secrets returned by Stripe stay method-local and are never exposed to the
 * WebView bridge, logs, SharedPreferences, or diagnostics.
 */
final class StripeTerminalBackendClient {
    private final KioskConfig config;

    StripeTerminalBackendClient(KioskConfig config) {
        this.config = config;
    }

    ConnectionTokenResult fetchConnectionToken(boolean simulatedReader) throws IOException {
        JSONObject response = post(body(
            "action", "connection_token",
            "stationId", config.stationId(),
            "simulatedReader", simulatedReader
        ));
        String secret = response.optString("secret", "");
        if (secret.isBlank()) throw new IOException("CONNECTION_TOKEN_MISSING");
        return new ConnectionTokenResult(
            secret,
            response.optString("locationId", ""),
            nullable(response.optString("expectedReaderId", ""))
        );
    }

    PaymentIntentResult createPaymentIntent(String rentalSessionId, boolean simulatedReader) throws IOException {
        JSONObject response = post(body(
            "action", "create_payment_intent",
            "rentalSessionId", rentalSessionId,
            "simulatedReader", simulatedReader
        ));
        String clientSecret = response.optString("clientSecret", "");
        String paymentIntentId = response.optString("paymentIntentId", "");
        if (clientSecret.isBlank() || paymentIntentId.isBlank()) {
            throw new IOException("TERMINAL_PAYMENT_INTENT_MISSING");
        }
        return new PaymentIntentResult(
            clientSecret,
            paymentIntentId,
            response.optString("rail", "NONE"),
            response.optString("railState", "UNCLAIMED"),
            response.optBoolean("serverConfirmed", false),
            response.optString("locationId", ""),
            nullable(response.optString("expectedReaderId", "")),
            response.optString("correlationId", "")
        );
    }

    PaymentStateResult getPaymentState(String rentalSessionId, boolean reconcile) throws IOException {
        JSONObject response = post(body(
            "action", reconcile ? "reconcile_payment_intent" : "get_payment_state",
            "rentalSessionId", rentalSessionId
        ));
        return new PaymentStateResult(
            response.optString("rail", "NONE"),
            response.optString("railState", "UNCLAIMED"),
            response.optBoolean("serverConfirmed", false),
            response.optBoolean("recoveryRequired", false),
            response.optString("correlationId", "")
        );
    }

    /**
     * Cancels an unconfirmed Terminal intent on the server. The server re-reads
     * Stripe first and refuses rather than guessing when a payment side effect
     * might already exist.
     */
    PaymentStateResult cancelPaymentIntent(String rentalSessionId) throws IOException {
        JSONObject response = post(body(
            "action", "cancel_payment_intent",
            "rentalSessionId", rentalSessionId
        ));
        return new PaymentStateResult(
            response.optString("rail", "NONE"),
            response.optString("railState", "UNCLAIMED"),
            response.optBoolean("serverConfirmed", false),
            response.optBoolean("recoveryRequired", false),
            response.optString("correlationId", "")
        );
    }

    private static JSONObject body(Object... pairs) throws IOException {
        if (pairs.length % 2 != 0) throw new IOException("TERMINAL_BACKEND_REQUEST_INVALID");
        JSONObject body = new JSONObject();
        try {
            for (int index = 0; index < pairs.length; index += 2) {
                body.put(String.valueOf(pairs[index]), pairs[index + 1]);
            }
            return body;
        } catch (JSONException error) {
            throw new IOException("TERMINAL_BACKEND_REQUEST_INVALID", error);
        }
    }

    private JSONObject post(JSONObject body) throws IOException {
        String endpoint = BuildConfig.STRIPE_TERMINAL_BACKEND_URL;
        if (endpoint == null || endpoint.isBlank()) throw new IOException("TERMINAL_BACKEND_DISABLED");

        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(15_000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("X-Kiosk-Token", config.kioskToken());

        byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(payload.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(payload);
        }

        int status = connection.getResponseCode();
        String raw = read(status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream());
        connection.disconnect();

        JSONObject response;
        try {
            response = raw.isBlank() ? new JSONObject() : new JSONObject(raw);
        } catch (Exception malformed) {
            throw new IOException("TERMINAL_BACKEND_INVALID_RESPONSE", malformed);
        }
        if (status < 200 || status >= 300 || !response.optBoolean("ok", false)) {
            String code = response.optString("error", "TERMINAL_BACKEND_HTTP_" + status);
            throw new IOException(safeCode(code));
        }
        return response;
    }

    private static String read(InputStream stream) throws IOException {
        if (stream == null) return "";
        StringBuilder out = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) out.append(line);
        }
        return out.toString();
    }

    private static String nullable(String value) {
        return value == null || value.isBlank() || "null".equalsIgnoreCase(value) ? null : value;
    }

    static String safeCode(String raw) {
        if (raw != null && raw.matches("^[A-Z0-9_]{3,100}$")) return raw;
        return "TERMINAL_BACKEND_FAILED";
    }

    static final class ConnectionTokenResult {
        private final String secret;
        private final String locationId;
        private final String expectedReaderId;

        ConnectionTokenResult(String secret, String locationId, String expectedReaderId) {
            this.secret = secret;
            this.locationId = locationId;
            this.expectedReaderId = expectedReaderId;
        }

        String secret() { return secret; }
        String locationId() { return locationId; }
        String expectedReaderId() { return expectedReaderId; }
    }

    static final class PaymentIntentResult {
        private final String clientSecret;
        private final String paymentIntentId;
        private final String rail;
        private final String railState;
        private final boolean serverConfirmed;
        private final String locationId;
        private final String expectedReaderId;
        private final String correlationId;

        PaymentIntentResult(
            String clientSecret,
            String paymentIntentId,
            String rail,
            String railState,
            boolean serverConfirmed,
            String locationId,
            String expectedReaderId,
            String correlationId
        ) {
            this.clientSecret = clientSecret;
            this.paymentIntentId = paymentIntentId;
            this.rail = rail;
            this.railState = railState;
            this.serverConfirmed = serverConfirmed;
            this.locationId = locationId;
            this.expectedReaderId = expectedReaderId;
            this.correlationId = correlationId;
        }

        String clientSecret() { return clientSecret; }
        String paymentIntentId() { return paymentIntentId; }
        String rail() { return rail; }
        String railState() { return railState; }
        boolean serverConfirmed() { return serverConfirmed; }
        String locationId() { return locationId; }
        String expectedReaderId() { return expectedReaderId; }
        String correlationId() { return correlationId; }
    }

    static final class PaymentStateResult {
        private final String rail;
        private final String railState;
        private final boolean serverConfirmed;
        private final boolean recoveryRequired;
        private final String correlationId;

        PaymentStateResult(
            String rail,
            String railState,
            boolean serverConfirmed,
            boolean recoveryRequired,
            String correlationId
        ) {
            this.rail = rail;
            this.railState = railState;
            this.serverConfirmed = serverConfirmed;
            this.recoveryRequired = recoveryRequired;
            this.correlationId = correlationId;
        }

        String rail() { return rail; }
        String railState() { return railState; }
        boolean serverConfirmed() { return serverConfirmed; }
        boolean recoveryRequired() { return recoveryRequired; }
        String correlationId() { return correlationId; }
    }
}
