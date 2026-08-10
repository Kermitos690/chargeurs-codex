package ch.chargeurs.kiosk;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.UUID;

public final class DeviceIdentity {
    private static final String PREFS = "chargeurs_device_identity";
    private static final String PUBLIC_ID = "public_id";

    private DeviceIdentity() {}

    public static synchronized String getOrCreate(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String existing = preferences.getString(PUBLIC_ID, null);
        if (existing != null) {
            try {
                UUID.fromString(existing);
                return existing;
            } catch (IllegalArgumentException ignored) {
                // Replace corrupted, non-secret local identity.
            }
        }
        String created = UUID.randomUUID().toString();
        if (!preferences.edit().putString(PUBLIC_ID, created).commit()) {
            throw new IllegalStateException("DEVICE_ID_STORAGE_FAILED");
        }
        return created;
    }
}
