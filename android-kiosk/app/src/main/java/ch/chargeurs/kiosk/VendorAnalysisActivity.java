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

/** Reusable passive vendor APK call-graph analysis. No vendor execution and no serial I/O. */
public final class VendorAnalysisActivity extends Activity {
    private static final String VENDOR_PACKAGE = "com.szbjkj.bajietouchpower";
    private static final String PREFS = "vendor_analysis";
    private static final String PREF_TERMS = "custom_terms";
    private static final String DEFAULT_TERMS =
        "PaymentEndActivity, initBatteryRental, writeBytes, readBytes, "
            + "setComPortParameters, getCommPort, openPort, closePort, "
            + "/dev/ttyS1, ttyS1, eject, slot, cabinet, crc, checksum, 9600, 115200";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private TextView statusView;
    private TextView detailView;
    private EditText customTermsView;
    private Button analyzeButton;
    private Button exportButton;
    private JSONObject analysis;
    private List<String> lastTerms = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(buildContent());
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
            "DTA21269 · corps de méthodes DEX · chemins statiques vers jSerialComm · aucune écriture série",
            16,
            Color.rgb(170, 201, 255),
            false
        );
        subtitle.setPadding(0, dp(5), 0, dp(18));
        root.addView(subtitle);

        statusView = text("Prêt pour l’analyse du graphe d’appels", 18, Color.rgb(255, 214, 102), true);
        statusView.setPadding(dp(14), dp(12), dp(14), dp(12));
        statusView.setBackgroundColor(Color.rgb(26, 42, 72));
        root.addView(statusView, matchWrap());

        TextView safety = text(
            "L’outil lit passivement les tables DEX, les corps de méthodes et les instructions invoke afin de relier PaymentEndActivity / initBatteryRental aux appels série. Il ne lance pas le fournisseur, ne copie pas son APK, n’ouvre pas /dev/ttyS1 et n’envoie aucun octet. Les littéraux affichés sont seulement le contexte de la méthode appelante, pas la preuve des arguments réellement transmis.",
            15,
            Color.rgb(222, 231, 247),
            false
        );
        safety.setPadding(0, dp(16), 0, dp(12));
        root.addView(safety);

        TextView termsTitle = text("Termes supplémentaires — modifiables sans reconstruire l’APK", 15, Color.WHITE, true);
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

        analyzeButton = actionButton("Analyser les appels DEX fournisseur", v -> runAnalysis());
        root.addView(analyzeButton);

        exportButton = actionButton("Exporter le rapport du graphe", v -> exportAnalysis());
        exportButton.setEnabled(false);
        root.addView(exportButton);

        TextView title = text("Résultat", 18, Color.WHITE, true);
        title.setPadding(0, dp(22), 0, dp(8));
        root.addView(title);

        detailView = text(
            "Le profil recherche les corps de méthodes de com.szbjkj.bajietouchpower, inventorie leurs instructions invoke et tente de construire un chemin statique jusqu’à getCommPort, openPort, setComPortParameters, writeBytes et readBytes.",
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

        setBusy(true, "Analyse des corps de méthodes DEX en cours…");
        executor.execute(() -> {
            JSONObject result = VendorApkAnalyzer.analyze(this, VENDOR_PACKAGE, lastTerms);
            mainHandler.post(() -> {
                analysis = result;
                render(result);
                exportButton.setEnabled(true);
                setBusy(false, "Analyse du graphe d’appels terminée");
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

    private void render(JSONObject result) {
        JSONObject archive = result.optJSONObject("archive");
        JSONArray dex = array(archive, "dexFiles");
        JSONArray binaries = array(archive, "nativeBinaries");
        JSONArray strings = array(archive, "relevantStrings");
        JSONArray classes = array(archive, "candidateClasses");
        JSONArray methods = array(archive, "candidateMethods");
        JSONArray fields = array(archive, "candidateFields");
        JSONArray calls = array(archive, "candidateCallSites");
        JSONArray graph = array(archive, "vendorCallGraphEdges");
        JSONArray chains = array(archive, "candidateCallChains");

        StringBuilder value = new StringBuilder();
        value.append("Version analyseur : ").append(BuildConfig.VERSION_NAME).append('\n');
        value.append("Paquet analyseur  : ").append(getPackageName()).append('\n');
        value.append("Paquet fournisseur: ").append(result.optString("package", VENDOR_PACKAGE)).append('\n');
        value.append("État              : ").append(result.optString("status", "?")).append('\n');
        value.append("Profil             : ").append(result.optString("profile", "?")).append('\n');
        value.append("APK lisible        : ").append(result.optBoolean("sourceReadable", false)).append('\n');
        value.append("Taille APK         : ").append(result.optLong("apkSizeBytes", 0L)).append(" octets\n");
        value.append("SHA-256            : ").append(result.optString("apkSha256", "indisponible")).append('\n');
        value.append("DEX analysés       : ").append(length(dex)).append('\n');
        value.append("Binaires natifs    : ").append(length(binaries)).append('\n');
        value.append("Chaînes ciblées    : ").append(length(strings)).append('\n');
        value.append("Classes candidates : ").append(length(classes)).append('\n');
        value.append("Méthodes candidates: ").append(length(methods)).append('\n');
        value.append("Champs candidats   : ").append(length(fields)).append('\n');
        value.append("Sites d’appel      : ").append(length(calls)).append('\n');
        value.append("Arêtes du graphe   : ").append(length(graph)).append('\n');
        value.append("Chemins vers série : ").append(length(chains)).append('\n');
        value.append("Statut chemins     : ")
            .append(archive == null ? "?" : archive.optString("callChainStatus", "?"))
            .append('\n');
        value.append("Scan tronqué       : ").append(archive != null && archive.optBoolean("scanTruncated", false)).append('\n');
        value.append("Protocole résolu   : false\n");
        value.append("APK copiée         : false\n");
        value.append("Code exécuté       : false\n");
        value.append("Port série ouvert  : false\n");
        value.append("Écriture série     : 0 octet\n");

        appendChains(value, chains, 10);
        appendCalls(value, calls, "HIGH", 18);
        appendMethods(value, methods, "HIGH", 16);

        if (binaries != null && binaries.length() > 0) {
            value.append("\nBinaires série trouvés :\n");
            for (int index = 0; index < Math.min(12, binaries.length()); index++) {
                JSONObject item = binaries.optJSONObject(index);
                if (item != null) value.append("- ").append(item.optString("name", "?")).append('\n');
            }
        }
        value.append("\nAttention : un chemin statique confirme des appels dans le bytecode, pas les valeurs dynamiques ni la trame exacte envoyée au matériel.\n");
        detailView.setText(value.toString());
    }

    private JSONArray array(JSONObject parent, String key) {
        return parent == null ? null : parent.optJSONArray(key);
    }

    private int length(JSONArray values) {
        return values == null ? 0 : values.length();
    }

    private void appendChains(StringBuilder value, JSONArray chains, int max) {
        if (chains == null) return;
        int shown = 0;
        for (int index = 0; index < chains.length() && shown < max; index++) {
            JSONObject item = chains.optJSONObject(index);
            if (item == null) continue;
            if (shown == 0) value.append("\nChemins statiques prioritaires :\n");
            value.append("- ")
                .append(item.optString("start", "?"))
                .append("\n  → ")
                .append(item.optString("sink", "?"))
                .append(" · profondeur ")
                .append(item.optInt("depth", -1))
                .append('\n');
            JSONArray path = item.optJSONArray("methods");
            if (path != null) {
                for (int step = 0; step < path.length(); step++) {
                    value.append("    ").append(step).append(": ").append(path.optString(step, "?")).append('\n');
                }
            }
            shown++;
        }
    }

    private void appendCalls(StringBuilder value, JSONArray calls, String priority, int max) {
        if (calls == null) return;
        int shown = 0;
        for (int index = 0; index < calls.length() && shown < max; index++) {
            JSONObject item = calls.optJSONObject(index);
            if (item == null || !priority.equals(item.optString("priority"))) continue;
            if (shown == 0) value.append("\nSites d’appel ").append(priority).append(" :\n");
            value.append("- ").append(item.optString("caller", "?"))
                .append("\n  → ").append(item.optString("callee", "?"))
                .append(" · ").append(item.optString("opcode", "?"))
                .append(" @+").append(item.optInt("codeByteOffset", -1)).append(" octets\n");
            JSONArray literals = item.optJSONArray("methodStringLiterals");
            if (literals != null && literals.length() > 0) {
                value.append("  contexte chaînes: ");
                for (int literal = 0; literal < Math.min(6, literals.length()); literal++) {
                    if (literal > 0) value.append(" | ");
                    value.append(literals.optString(literal, "?"));
                }
                value.append('\n');
            }
            JSONArray numbers = item.optJSONArray("methodNumericLiterals");
            if (numbers != null && numbers.length() > 0) {
                value.append("  contexte nombres: ");
                for (int literal = 0; literal < Math.min(8, numbers.length()); literal++) {
                    if (literal > 0) value.append(", ");
                    value.append(numbers.optLong(literal));
                }
                value.append('\n');
            }
            shown++;
        }
    }

    private void appendMethods(StringBuilder value, JSONArray methods, String priority, int max) {
        if (methods == null) return;
        int shown = 0;
        for (int index = 0; index < methods.length() && shown < max; index++) {
            JSONObject item = methods.optJSONObject(index);
            if (item == null || !priority.equals(item.optString("priority"))) continue;
            if (shown == 0) value.append("\nMéthodes ").append(priority).append(" :\n");
            value.append("- ").append(item.optString("signature", "?")).append('\n');
            shown++;
        }
    }

    private void exportAnalysis() {
        if (analysis == null) {
            Toast.makeText(this, "Lance d’abord l’analyse.", Toast.LENGTH_SHORT).show();
            return;
        }
        setBusy(true, "Création du rapport du graphe…");
        executor.execute(() -> {
            try {
                JSONObject report = new JSONObject();
                report.put("schemaVersion", 3);
                report.put("mode", "vendor_apk_dex_callgraph_analysis");
                report.put("stationId", "DTA21269");
                report.put("analyzerVersion", BuildConfig.VERSION_NAME);
                report.put("analyzerPackage", getPackageName());
                report.put("generatedAt", System.currentTimeMillis());
                report.put("customTerms", new JSONArray(lastTerms));
                report.put("serialPortOpened", false);
                report.put("serialWrites", 0);
                report.put("physicalEjectionEnabled", false);
                report.put("vendorApkCopied", false);
                report.put("vendorCodeExecuted", false);
                report.put("protocolSolved", false);
                report.put("analysis", analysis);

                String filename = "DTA21269_DEX_CALLGRAPH_ANALYSIS_"
                    + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date())
                    + ".json";
                Uri destination = saveDownload(filename, report.toString(2));
                mainHandler.post(() -> {
                    setBusy(false, "Rapport du graphe exporté");
                    Toast.makeText(
                        this,
                        destination == null ? "Rapport enregistré dans le dossier de l’application." : "Rapport enregistré dans Téléchargements/Chargeurs.",
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
        if (directory == null && (directory = getFilesDir()) == null) throw new IllegalStateException("NO_STORAGE");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("MKDIR_FAILED");
        File file = new File(directory, filename);
        try (OutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
        }
        return Uri.fromFile(file);
    }

    private void setBusy(boolean busy, String message) {
        statusView.setText(message);
        analyzeButton.setEnabled(!busy);
        customTermsView.setEnabled(!busy);
        exportButton.setEnabled(!busy && analysis != null);
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
