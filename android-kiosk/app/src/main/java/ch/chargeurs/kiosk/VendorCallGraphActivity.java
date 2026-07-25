package ch.chargeurs.kiosk;

import android.app.Activity;
import android.content.ContentValues;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Passive DEX call-graph UI. It never opens or writes to a serial port. */
public final class VendorCallGraphActivity extends Activity {
    private static final String VENDOR_PACKAGE = "com.szbjkj.bajietouchpower";
    private static final String PREFS = "vendor_call_graph";
    private static final String PREF_TERMS = "custom_terms";
    private static final String DEFAULT_TERMS =
        "PaymentEndActivity, initBatteryRental, writeBytes, readBytes, "
            + "setComPortParameters, getCommPort, openPort, closePort, "
            + "/dev/ttyS1, ttyS1, SerialPort, jSerialComm, eject, slot, "
            + "cabinet, battery, crc16, checksum, 9600, 115200, AT+";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private TextView statusView;
    private TextView detailView;
    private EditText customTermsView;
    private Button analyzeButton;
    private Button exportButton;
    private JSONObject report;
    private List<String> lastTerms = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(buildContent());
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
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

        root.addView(text("Chargeurs.ch — Graphe d’appels DTA", 27, Color.WHITE, true));
        TextView subtitle = text(
            "DTA21269 · DEX statique · chemins vers jSerialComm · aucune écriture série",
            16,
            Color.rgb(170, 201, 255),
            false
        );
        subtitle.setPadding(0, dp(5), 0, dp(18));
        root.addView(subtitle);

        statusView = text("Prêt pour l’analyse du graphe DEX", 18, Color.rgb(255, 214, 102), true);
        statusView.setPadding(dp(14), dp(12), dp(14), dp(12));
        statusView.setBackgroundColor(Color.rgb(26, 42, 72));
        root.addView(statusView, matchWrap());

        TextView safety = text(
            "Cette version décode uniquement les métadonnées DEX, les méthodes définies, les instructions invoke et les chaînes référencées. Elle ne lance pas BajieTouchPower, ne copie pas son APK, n’ouvre pas /dev/ttyS1, ne récupère aucun secret et n’envoie aucun octet au PCB.",
            15,
            Color.rgb(222, 231, 247),
            false
        );
        safety.setPadding(0, dp(16), 0, dp(12));
        root.addView(safety);

        TextView termsTitle = text("Termes ciblés — modifiables sans reconstruire l’APK", 15, Color.WHITE, true);
        termsTitle.setPadding(0, dp(8), 0, dp(6));
        root.addView(termsTitle);

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        customTermsView = new EditText(this);
        customTermsView.setText(prefs.getString(PREF_TERMS, DEFAULT_TERMS));
        customTermsView.setTextColor(Color.WHITE);
        customTermsView.setHintTextColor(Color.rgb(150, 170, 200));
        customTermsView.setHint("Mots-clés séparés par des virgules");
        customTermsView.setTextSize(14);
        customTermsView.setSingleLine(false);
        customTermsView.setMinLines(3);
        customTermsView.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        customTermsView.setPadding(dp(14), dp(12), dp(14), dp(12));
        customTermsView.setBackgroundColor(Color.rgb(13, 29, 54));
        root.addView(customTermsView, matchWrap());

        analyzeButton = actionButton("Construire le graphe d’appels", view -> runAnalysis());
        root.addView(analyzeButton);

        exportButton = actionButton("Exporter le rapport v1.4", view -> exportAnalysis());
        exportButton.setEnabled(false);
        root.addView(exportButton);

        TextView title = text("Résultat", 18, Color.WHITE, true);
        title.setPadding(0, dp(22), 0, dp(8));
        root.addView(title);

        detailView = text(
            "L’analyse cherchera des chemins statiques entre PaymentEndActivity / initBatteryRental et les appels série comme writeBytes, openPort et setComPortParameters.",
            14,
            Color.rgb(197, 214, 238),
            false
        );
        detailView.setTextIsSelectable(true);
        detailView.setTypeface(android.graphics.Typeface.MONOSPACE);
        detailView.setPadding(dp(14), dp(14), dp(14), dp(14));
        detailView.setBackgroundColor(Color.rgb(13, 29, 54));
        root.addView(detailView, matchWrap());

        return scroll;
    }

    private void runAnalysis() {
        lastTerms = parseTerms(customTermsView.getText().toString());
        getSharedPreferences(PREFS, MODE_PRIVATE)
            .edit()
            .putString(PREF_TERMS, customTermsView.getText().toString())
            .apply();

        setBusy(true, "Lecture statique des DEX et construction du graphe…");
        executor.execute(() -> {
            JSONObject callGraph = VendorDexCallGraphAnalyzer.analyze(this, VENDOR_PACKAGE, lastTerms);
            JSONObject inventory = VendorApkAnalyzer.analyze(this, VENDOR_PACKAGE, lastTerms);
            JSONObject combined = new JSONObject();
            try {
                combined.put("schemaVersion", 3);
                combined.put("mode", "vendor_apk_dex_call_graph_analysis");
                combined.put("stationId", "DTA21269");
                combined.put("analyzerVersion", BuildConfig.VERSION_NAME);
                combined.put("analyzerPackage", getPackageName());
                combined.put("generatedAt", System.currentTimeMillis());
                combined.put("customTerms", new JSONArray(lastTerms));
                combined.put("safeReadOnly", true);
                combined.put("vendorCodeExecuted", false);
                combined.put("serialPortOpened", false);
                combined.put("serialWrites", 0);
                combined.put("physicalEjectionEnabled", false);
                combined.put("protocolSolved", false);
                combined.put("payloadRecovered", false);
                combined.put("inventory", inventory);
                combined.put("callGraph", callGraph);
            } catch (Exception ignored) {
                // All values are bounded primitives or JSON objects.
            }

            mainHandler.post(() -> {
                report = combined;
                render(combined);
                exportButton.setEnabled(true);
                setBusy(false, "Analyse du graphe DEX terminée");
            });
        });
    }

    private List<String> parseTerms(String raw) {
        List<String> result = new ArrayList<>();
        if (raw == null) return result;
        for (String value : raw.split("[,;\\n]")) {
            String clean = value.trim();
            if (!clean.isEmpty() && clean.length() <= 120) result.add(clean);
        }
        return result;
    }

    private void render(JSONObject combined) {
        JSONObject callGraph = combined.optJSONObject("callGraph");
        JSONObject graph = callGraph == null ? null : callGraph.optJSONObject("graph");
        JSONArray roots = graph == null ? null : graph.optJSONArray("roots");
        JSONArray sinks = graph == null ? null : graph.optJSONArray("sinks");
        JSONArray paths = graph == null ? null : graph.optJSONArray("paths");
        JSONArray evidence = graph == null ? null : graph.optJSONArray("methodEvidence");
        JSONArray dexFiles = graph == null ? null : graph.optJSONArray("dexFiles");

        StringBuilder value = new StringBuilder();
        value.append("Version analyseur : ").append(BuildConfig.VERSION_NAME).append('\n');
        value.append("Paquet analyseur  : ").append(getPackageName()).append('\n');
        value.append("Paquet fournisseur: ").append(VENDOR_PACKAGE).append('\n');
        value.append("État              : ").append(callGraph == null ? "?" : callGraph.optString("status", "?")).append('\n');
        value.append("Profil             : ").append(callGraph == null ? "?" : callGraph.optString("profile", "?")).append('\n');
        value.append("DEX analysés       : ").append(dexFiles == null ? 0 : dexFiles.length()).append('\n');
        value.append("Méthodes décodées  : ").append(graph == null ? 0 : graph.optInt("parsedCodeMethods", 0)).append('\n');
        value.append("Unités de code     : ").append(graph == null ? 0 : graph.optInt("codeUnitsScanned", 0)).append('\n');
        value.append("Appels invoke      : ").append(graph == null ? 0 : graph.optInt("invokeEdgeCount", 0)).append('\n');
        value.append("Racines ciblées    : ").append(roots == null ? 0 : roots.length()).append('\n');
        value.append("Sorties série      : ").append(sinks == null ? 0 : sinks.length()).append('\n');
        value.append("Chemins trouvés    : ").append(paths == null ? 0 : paths.length()).append('\n');
        value.append("Statut chemins     : ").append(graph == null ? "?" : graph.optString("pathStatus", "?")).append('\n');
        value.append("Graphe tronqué     : ").append(graph != null && graph.optBoolean("graphTruncated", false)).append('\n');
        value.append("Protocole résolu   : false\n");
        value.append("Payload récupéré   : false\n");
        value.append("Port série ouvert  : false\n");
        value.append("Écriture série     : 0 octet\n");

        if (paths != null && paths.length() > 0) {
            value.append("\nChemins statiques prioritaires :\n");
            for (int index = 0; index < Math.min(12, paths.length()); index++) {
                JSONObject path = paths.optJSONObject(index);
                if (path == null) continue;
                JSONArray methods = path.optJSONArray("methods");
                value.append("\n#").append(index + 1).append(" profondeur ")
                    .append(path.optInt("depth", 0)).append('\n');
                if (methods != null) {
                    for (int methodIndex = 0; methodIndex < methods.length(); methodIndex++) {
                        value.append(methodIndex == 0 ? "  " : "  -> ")
                            .append(methods.optString(methodIndex, "?"))
                            .append('\n');
                    }
                }
            }
        } else {
            value.append("\nAucun chemin complet n’est prouvé dans cette passe. Les racines, sorties et appelants proches restent exportés pour l’analyse suivante.\n");
        }

        if (evidence != null && evidence.length() > 0) {
            value.append("\nMéthodes avec chaînes ou appels ciblés :\n");
            for (int index = 0; index < Math.min(16, evidence.length()); index++) {
                JSONObject item = evidence.optJSONObject(index);
                if (item == null) continue;
                value.append("- ").append(item.optString("method", "?")).append('\n');
                JSONArray strings = item.optJSONArray("strings");
                if (strings != null) {
                    for (int stringIndex = 0; stringIndex < Math.min(3, strings.length()); stringIndex++) {
                        JSONObject stringItem = strings.optJSONObject(stringIndex);
                        if (stringItem != null) {
                            value.append("    chaîne: ").append(stringItem.optString("value", "?")).append('\n');
                        }
                    }
                }
            }
        }

        detailView.setText(value.toString());
    }

    private void exportAnalysis() {
        if (report == null) {
            Toast.makeText(this, "Lance d’abord l’analyse.", Toast.LENGTH_SHORT).show();
            return;
        }
        setBusy(true, "Création du rapport de graphe…");
        executor.execute(() -> {
            try {
                String filename = "DTA21269_DEX_CALL_GRAPH_"
                    + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date())
                    + ".json";
                Uri destination = saveDownload(filename, report.toString(2));
                mainHandler.post(() -> {
                    setBusy(false, "Rapport de graphe exporté");
                    Toast.makeText(
                        this,
                        destination == null
                            ? "Rapport enregistré dans le dossier de l’application."
                            : "Rapport enregistré dans Téléchargements/Chargeurs.",
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
        if (directory == null) directory = getFilesDir();
        if (directory == null) throw new IllegalStateException("NO_STORAGE");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("MKDIR_FAILED");
        File file = new File(directory, filename);
        try (OutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
        }
        return null;
    }

    private void setBusy(boolean busy, String status) {
        analyzeButton.setEnabled(!busy);
        exportButton.setEnabled(!busy && report != null);
        statusView.setText(status);
    }

    private Button actionButton(String label, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(16);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = matchWrap();
        params.topMargin = dp(12);
        button.setLayoutParams(params);
        return button;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
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
}
