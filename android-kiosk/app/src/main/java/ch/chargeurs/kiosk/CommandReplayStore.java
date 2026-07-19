package ch.chargeurs.kiosk;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Map;

public final class CommandReplayStore {
    private static final String PREFS = "chargeurs_hardware_command_replay_v1";
    private final SharedPreferences preferences;

    public CommandReplayStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized boolean claim(String commandId, long expiresAtSeconds) {
        long now = System.currentTimeMillis() / 1000L;
        SharedPreferences.Editor editor = preferences.edit();
        for (Map.Entry<String, ?> entry : preferences.getAll().entrySet()) {
            Object value = entry.getValue();
            if (value instanceof Long && (Long) value <= now) editor.remove(entry.getKey());
        }
        if (preferences.contains(commandId)) {
            editor.apply();
            return false;
        }
        return editor.putLong(commandId, expiresAtSeconds).commit();
    }
}
