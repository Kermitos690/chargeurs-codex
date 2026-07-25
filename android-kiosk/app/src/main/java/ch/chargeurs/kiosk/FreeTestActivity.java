package ch.chargeurs.kiosk;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Local, payment-free qualification shell for the owned DTA21269 pilot.
 *
 * This build deliberately performs no serial write and no physical ejection.
 * It validates the local runtime, creates a FreeTest session, records supervised
 * phase markers and exports a redacted technical report. The physical command
 * remains fail-closed until the DTA frame is confirmed by an authorized test.
 */
public final class FreeTestActivity extends Activity {
    private static final String STATION_ID = "DTA21269";
    private static final String VENDOR_PACKAGE = "com.szbjkj.bajietouchpower";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final JSONArray events = new JSONArray();

    private TextView statusView;
    private TextView detailView;
    private Button startButton;
    private Button beforeButton;
    private Button takenButton;
    private Button returnedButton;
    private Button exportButton;

    private JSONObject diagnosticReport;
    private String sessionId;
    private String sessionState = "IDLE";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(buildContent());
        appendEvent("app_started", "Gateway FreeTest locale ouverte");
        mainHandler.postDelayed(this::runDiagnostic, 500L);
    }

    private View buildContent() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(7, 16, 35));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(22), dp(22), dp(22), dp(32));
        scroll.addView(root, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView title = text("Chargeurs.ch — Gateway FreeTest", 27, Color.WHITE, true);
        root.addView(title);

        TextView subtitle = text(
            "Station " + STATION_ID + " · 0 CHF · sans Stripe · sans Supabase obligatoire",
            16,
            Color.rgb(170, 201, 255),
            false
        );
        subtitle.setPadding(0, dp(5), 0, dp(18));
        root.addView(subtitle);

        statusView = text("Initialisation locale…", 18, Color.rgb(255, 214, 102), true);
        statusView.setPadding(dp(14), dp(12), dp(14), dp(12));
        statusView.setBackgroundColor(Color.rgb(26, 42, 72));
        root.addView(statusView, matchWrap());

        TextView safety = text(
            "Sécurité active : aucune donnée bancaire, aucune écriture sur /dev/ttyS1 et aucune éjection tant que la trame DTA n’est pas confirmée.",
            15,
            Color.rgb(222, 231, 247),
            false
        );
        safety.setPadding(0, dp(16), 0, dp(12));
        root.addView(safety);

        root.addView(actionButton("1 · Analyser la borne", v -> runDiagnostic()));

        startButton = actionButton("2 · Démarrer une session FreeTest", v -> startFreeTest());
        root.addView(startButton);

        beforeButton = actionButton("Marquer : juste avant la sortie", v -> markPhase("BEFORE_TAKE", "Avant sortie"));
        takenButton = actionButton("Marquer : batterie sortie", v -> markPhase("BATTERY_TAKEN", "Batterie sortie"));
        returnedButton = actionButton("Marquer : batterie retournée", v -> markPhase("BATTERY_RETURNED", "Batterie retournée"));
        setPhaseButtonsEnabled(false);
        root.addView(beforeButton);
        root.addView(takenButton);
        root.addView(returnedButton);

        root.addView(actionButton("Test d’éjection locale", v -> explainEjectionLock()));
        root.addView(actionButton("Ouvrir l’application fournisseur", v -> launchVendorApp()));

        exportButton = actionButton("Exporter le rapport FreeTest", v -> exportReport());
        root.addView(exportButton);

        root.addView(actionButton("Copier le résumé", v -> copySummary()));

        TextView detailTitle = text("État technique", 18, Color.WHITE, true);
        detailTitle.setPadding(0, dp(22), 0, dp(8));
        root.addView(detailTitle);

        detailView = text("Analyse en cours…", 14, Color.rgb(197, 214, 238), false);
        detailView.setTextIsSelectable(true);
        detailView.setTypeface(android.graphics.Typeface.MONOSPACE);
        detailView.setPadding(dp(14), dp(14), dp(14), dp(14));
        detailView.setBackgroundColor(Color.rgb(13, 29, 54));
        root.addView(detailView, matchWrap());

        return scroll;
    }

    private void runDiagnostic() {
        setBusy(true, "Analyse locale de DTA21269…");
        executor.execute(() -> {
            JSONObject report = HardwareDiagnosticCollector.collect(this);
            mainHandler.post(() -> {
                diagnosticReport = report;
                appendEvent("diagnostic_completed", "Inventaire local terminé");
                renderDiagnostic(report);
                setBusy(false, "Prêt pour une session FreeTest locale");
            });
        });
    }

    private void renderDiagnostic(JSONObject report) {
        JSONObject device = report.optJSONObject("device");
        JSONObject vendor = report.optJSONObject("vendorApp");
        JSONObject connectivity = report.optJSONObject("connectivity");
        JSONArray tty = report.optJSONArray("tty");
        JSONObject pilotTty = findTty(tty, "/dev/ttyS1");

        StringBuilder value = new StringBuilder();
        value.append("Station            : ").append(STATION_ID).append('\n');
        value.append("Version Gateway    : ").append(BuildConfig.VERSION_NAME).append('\n');
        value.append("Android            : ")
            .append(device == null ? "?" : device.optString("release", "?"))
            .append(" / API ")
            .append(device == null ? "?" : device.optInt("sdk", 0))
            .append('\n');
        value.append("Tablette           : ")
            .append(device == null ? Build.MODEL : device.optString("model", Build.MODEL))
            .append('\n');
        value.append("APK fournisseur    : ")
            .append(vendor != null && vendor.optBoolean("installed", false) ? "installée" : "absente")
            .append(vendor == null ? "" : " · " + vendor.optString("versionName", ""))
            .append('\n');
        value.append("Réseau             : ")
            .append(connectivity != null && connectivity.optBoolean("active", false) ? "actif" : "hors ligne")
            .append(connectivity != null && connectivity.optBoolean("vpn", false) ? " · VPN" : "")
            .append('\n');
        value.append("Port /dev/ttyS1    : ");
        if (pilotTty == null) {
            value.append("non détecté");
        } else {
            value.append("détecté · lecture=")
                .append(pilotTty.optBoolean("readable", false))
                .append(" · écriture=")
                .append(pilotTty.optBoolean("writable", false));
        }
        value.append('\n');
        value.append("Écriture série     : 0 octet (verrouillée)\n");
        value.append("Paiement           : FreeTest local / 0 CHF\n");
        value.append("Éjection physique  : NOT_CONFIGURED\n");
        value.append("Session            : ").append(sessionId == null ? "aucune" : sessionId).append('\n');
        value.append("État session       : ").append(sessionState).append('\n');
        value.append("Événements         : ").append(events.length()).append('\n');

        detailView.setText(value.toString());
    }

    private JSONObject findTty(JSONArray tty, String path) {
        if (tty == null) return null;
        for (int index = 0; index < tty.length(); index++) {
            JSONObject item = tty.optJSONObject(index);
            if (item != null && path.equals(item.optString("path"))) return item;
        }
        return null;
    }

    private void startFreeTest() {
        if (sessionId != null && !"BATTERY_RETURNED".equals(sessionState)) {
            new AlertDialog.Builder(this)
                .setTitle("Session déjà active")
                .setMessage(sessionId + " est encore dans l’état " + sessionState + ".")
                .setPositiveButton("Continuer", null)
                .show();
            return;
        }

        sessionId = "FT-" + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date())
            + "-" + UUID.randomUUID().toString().substring(0, 4).toUpperCase(Locale.US);
        sessionState = "STARTED";
        appendEvent("freetest_started", "Session locale gratuite créée");
        setPhaseButtonsEnabled(true);
        startButton.setText("Session FreeTest active : " + sessionId);
        statusView.setText("FreeTest actif — aucune transaction financière");
        renderDiagnostic(diagnosticReport == null ? new JSONObject() : diagnosticReport);
    }

    private void markPhase(String state, String label) {
        if (sessionId == null) {
            Toast.makeText(this, "Démarre d’abord une session FreeTest.", Toast.LENGTH_SHORT).show();
            return;
        }
        sessionState = state;
        appendEvent("phase", label);
        statusView.setText(label + " enregistré à " + localTime());
        if ("BATTERY_RETURNED".equals(state)) {
            setPhaseButtonsEnabled(false);
            startButton.setText("Démarrer une nouvelle session FreeTest");
        }
        renderDiagnostic(diagnosticReport == null ? new JSONObject() : diagnosticReport);
    }

    private void explainEjectionLock() {
        appendEvent("ejection_test_requested", "Refus fermé : trame DTA non validée");
        new AlertDialog.Builder(this)
            .setTitle("Éjection encore verrouillée")
            .setMessage(
                "Le mode FreeTest fonctionne sans Stripe, mais la commande physique DTA n’est pas encore confirmée. "
                    + "Cette version n’envoie donc aucun octet au PCB et ne peut pas sortir une batterie. "
                    + "Le rapport exporté sert à valider la prochaine version avec pilote DTA."
            )
            .setPositiveButton("Compris", null)
            .show();
    }

    private void launchVendorApp() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(VENDOR_PACKAGE);
        if (launch == null) {
            Toast.makeText(this, "Application fournisseur introuvable.", Toast.LENGTH_LONG).show();
            return;
        }
        appendEvent("vendor_app_opened", "Ouverture manuelle de l’APK fournisseur");
        startActivity(launch);
    }

    private void exportReport() {
        setBusy(true, "Création du rapport FreeTest…");
        executor.execute(() -> {
            try {
                JSONObject report = new JSONObject();
                report.put("schemaVersion", 1);
                report.put("mode", "local_freetest_read_only");
                report.put("stationId", STATION_ID);
                report.put("appVersion", BuildConfig.VERSION_NAME);
                report.put("generatedAt", System.currentTimeMillis());
                report.put("sessionId", sessionId == null ? JSONObject.NULL : sessionId);
                report.put("sessionState", sessionState);
                report.put("serialWrites", 0);
                report.put("physicalEjectionEnabled", false);
                report.put("stripeConfigured", false);
                report.put("events", events);
                report.put("diagnostic", diagnosticReport == null ? JSONObject.NULL : diagnosticReport);

                String filename = "DTA21269_FREETEST_"
                    + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date())
                    + ".json";
                Uri destination = saveDownload(filename, report.toString(2));
                mainHandler.post(() -> {
                    setBusy(false, "Rapport FreeTest exporté");
                    Toast.makeText(
                        this,
                        destination == null ? "Rapport enregistré dans le dossier de l’application." : "Rapport enregistré dans Téléchargements.",
                        Toast.LENGTH_LONG
                    ).show();
                });
            } catch (Exception error) {
                mainHandler.post(() -> {
                    setBusy(false, "Échec de l’export");
                    Toast.makeText(this, error.getClass().getSimpleName(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private Uri saveDownload(String filename, String content) throws Exception {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Chargeurs");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("DOWNLOAD_INSERT_FAILED");
            try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                if (output == null) throw new IllegalStateException("DOWNLOAD_OPEN_FAILED");
                output.write(bytes);
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            getContentResolver().update(uri, values, null, null);
            return uri;
        }

        File directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (directory == null && (directory = getFilesDir()) == null) {
            throw new IllegalStateException("NO_STORAGE");
        }
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("MKDIR_FAILED");
        File file = new File(directory, filename);
        try (OutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
        }
        return Uri.fromFile(file);
    }

    private void copySummary() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) return;
        clipboard.setPrimaryClip(ClipData.newPlainText("Chargeurs FreeTest", detailView.getText()));
        Toast.makeText(this, "Résumé copié.", Toast.LENGTH_SHORT).show();
    }

    private void appendEvent(String type, String message) {
        JSONObject item = new JSONObject();
        try {
            item.put("at", System.currentTimeMillis());
            item.put("localTime", localTime());
            item.put("type", type);
            item.put("message", message);
            item.put("sessionId", sessionId == null ? JSONObject.NULL : sessionId);
            item.put("state", sessionState);
            events.put(item);
        } catch (JSONException ignored) {
            // Fixed primitive values cannot normally fail JSON serialization.
        }
    }

    private String localTime() {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(new Date());
    }

    private void setBusy(boolean busy, String message) {
        statusView.setText(message);
        exportButton.setEnabled(!busy);
        startButton.setEnabled(!busy);
    }

    private void setPhaseButtonsEnabled(boolean enabled) {
        beforeButton.setEnabled(enabled);
        takenButton.setEnabled(enabled);
        returnedButton.setEnabled(enabled);
    }

    private Button actionButton(String label, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(16);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER_VERTICAL);
        button.setPadding(dp(16), dp(10), dp(16), dp(10));
        button.setBackgroundColor(Color.rgb(31, 87, 166));
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(58)
        );
        params.topMargin = dp(9);
        button.setLayoutParams(params);
        return button;
    }

    private TextView text(String value, int sizeSp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        if (bold) view.setTypeface(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD);
        return view;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
