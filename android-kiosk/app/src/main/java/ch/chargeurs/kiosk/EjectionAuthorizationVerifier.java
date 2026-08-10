package ch.chargeurs.kiosk;

import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;

public final class EjectionAuthorizationVerifier {
    private static final long MAX_AUTHORIZATION_LIFETIME_SECONDS = 120L;

    private final String stationId;
    private final String devicePublicId;
    private final PublicKey publicKey;

    public EjectionAuthorizationVerifier(String stationId, String devicePublicId, String publicKeyBase64) {
        this.stationId = stationId;
        this.devicePublicId = devicePublicId;
        this.publicKey = parsePublicKey(publicKeyBase64);
    }

    public EjectionAuthorization verify(String compactJws) throws Exception {
        if (publicKey == null) throw new IllegalStateException("EJECTION_AUTH_NOT_CONFIGURED");
        if (compactJws == null || compactJws.length() > 8192) throw new IllegalArgumentException("INVALID_AUTHORIZATION");
        String[] parts = compactJws.split("\\.", -1);
        if (parts.length != 3) throw new IllegalArgumentException("INVALID_AUTHORIZATION");

        JSONObject header = new JSONObject(new String(decodeUrl(parts[0]), StandardCharsets.UTF_8));
        if (!"RS256".equals(header.optString("alg"))) throw new IllegalArgumentException("UNSUPPORTED_SIGNATURE");

        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(publicKey);
        verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        if (!verifier.verify(decodeUrl(parts[2]))) throw new SecurityException("INVALID_SIGNATURE");

        JSONObject payload = new JSONObject(new String(decodeUrl(parts[1]), StandardCharsets.UTF_8));
        long now = System.currentTimeMillis() / 1000L;
        long issuedAt = payload.optLong("iat", 0L);
        long expiresAt = payload.optLong("exp", 0L);
        int slot = payload.optInt("slot", 0);
        String commandId = payload.optString("command_id", "");
        String nonce = payload.optString("nonce", "");
        String rentalSessionId = payload.optString("rental_session_id", "");

        if (!stationId.equals(payload.optString("station_id"))) throw new SecurityException("STATION_MISMATCH");
        if (!devicePublicId.equals(payload.optString("device_id"))) throw new SecurityException("DEVICE_MISMATCH");
        if (!"payment_succeeded".equals(payload.optString("payment_state"))) throw new SecurityException("PAYMENT_NOT_CONFIRMED");
        if (issuedAt < now - MAX_AUTHORIZATION_LIFETIME_SECONDS || issuedAt > now + 30L) throw new SecurityException("INVALID_ISSUED_AT");
        if (expiresAt <= now || expiresAt > now + MAX_AUTHORIZATION_LIFETIME_SECONDS) throw new SecurityException("AUTHORIZATION_EXPIRED");
        if (slot < 1 || slot > 128) throw new SecurityException("INVALID_SLOT");
        if (!safeIdentifier(commandId) || !safeIdentifier(nonce) || !isUuid(rentalSessionId)) {
            throw new SecurityException("INVALID_AUTHORIZATION_CLAIMS");
        }
        return new EjectionAuthorization(commandId, nonce, rentalSessionId, slot, expiresAt);
    }

    private static boolean safeIdentifier(String value) {
        return value != null && value.matches("^[A-Za-z0-9_-]{8,128}$");
    }

    private static boolean isUuid(String value) {
        return value != null && value.matches("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$");
    }

    private static byte[] decodeUrl(String value) {
        return Base64.decode(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static PublicKey parsePublicKey(String value) {
        if (value == null || value.trim().isEmpty()) return null;
        try {
            byte[] der = Base64.decode(value.replaceAll("\\s", ""), Base64.DEFAULT);
            return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
        } catch (Exception exception) {
            return null;
        }
    }
}
