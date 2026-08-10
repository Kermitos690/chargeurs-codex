package ch.chargeurs.kiosk;

import org.json.JSONException;
import org.json.JSONObject;

/** Small checked-exception boundary for JSON assembled from trusted app values. */
public final class JsonObjects {
    private JsonObjects() {}

    public static JSONObject of(Object... keysAndValues) {
        if (keysAndValues.length % 2 != 0) {
            throw new IllegalArgumentException("JSON_KEY_VALUE_MISMATCH");
        }
        JSONObject result = new JSONObject();
        try {
            for (int index = 0; index < keysAndValues.length; index += 2) {
                result.put(String.valueOf(keysAndValues[index]), keysAndValues[index + 1]);
            }
            return result;
        } catch (JSONException exception) {
            throw new IllegalStateException("JSON_ENCODING_FAILED", exception);
        }
    }
}
