package ch.chargeurs.kiosk;

import android.content.Context;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

public final class LocalAuditLog {
    private static final long MAX_BYTES = 256 * 1024L;
    private final File file;

    public LocalAuditLog(Context context) {
        file = new File(context.getFilesDir(), "hardware-audit.ndjson");
    }

    public synchronized void record(String event, JSONObject details) {
        try {
            if (file.length() > MAX_BYTES) {
                File rotated = new File(file.getParentFile(), "hardware-audit.previous.ndjson");
                if (rotated.exists()) rotated.delete();
                file.renameTo(rotated);
            }
            JSONObject line = new JSONObject()
                .put("at", System.currentTimeMillis())
                .put("event", event)
                .put("details", details == null ? new JSONObject() : details);
            try (FileOutputStream output = new FileOutputStream(file, true)) {
                output.write((line.toString() + "\n").getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) {
            // Audit failure must never weaken the authorization decision.
        }
    }
}

