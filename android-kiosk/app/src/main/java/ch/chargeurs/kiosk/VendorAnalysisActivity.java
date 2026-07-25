package ch.chargeurs.kiosk;

import android.app.Activity;
import android.content.ContentValues;
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
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Passive vendor APK analysis. No vendor code execution and no serial I/O. */
public final class VendorAnalysisActivity extends Activity {
    private static final String VENDOR_PACKAGE = "com.szbjkj.bajietouchpower";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private TextView statusView;
    private TextView detailView;
    private Button analyzeButton;
    private Button exportButton;
    private JSONObject analysis;

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

        root.addView(text("Chargeurs.ch — Analyse fournisseur", 27, Color.WHITE, true));
        TextView subtitle = text(
            "DTA21269 · analyse statique locale · aucune écriture série",
            16,
            Color.rgb(170, 201, 255),
            false
        );
        subtitle.setPadding(0, dp(5), 0, dp(18));
        root.addView(subtitle);

        statusView = text("Prêt pour l’analyse passive", 18, Color.rgb(255, 214, 102), true);
        statusView.setPadding(dp(14), dp(12), dp(14), dp(12));
        statusView.setBackgroundColor(Color.rgb(26, 42, 72));
        root.addView(statusView, matchWrap());

        TextView safety = text(
            "Cette analyse ne lance pas le code fournisseur, ne copie pas son APK, n’ouvre pas /dev/ttyS1 et n’envoie aucun octet au contrôleur.",
            15,
            Color.rgb(222, 231, 247),
            false
        );
        safety.setPadding(0, dp(16), 0, dp(12));
        root.addView(safety);

        analyzeButton = actionButton("Analyser l’APK fournisseur", v -> runAnalysis());
        root.addView(analyzeButton);

        exportButton = actionButton("Exporter le rapport d’analyse", v -> exportAnalysis());
        exportButton.setEnabled(false);
        root.addView(exportButton);

        TextView title = text("Résultat", 18, Color.WHITE, true);
        title.setPadding(0, dp(22), 0, dp(8));
        root.addView(title);

        detailView = text(
            "L’analyse recherchera notamment : CLOUDPOS_SERIAL, /dev/ttyS1, baud, 9600, CRC, checksum, slot, eject, cabinet et battery.",
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
        setBusy(true, "Analyse statique en cours…");
        executor.execute(() -> {
            JSONObject result = VendorApkAnalyzer.analyze(this, VENDOR_PACKAGE);
            mainHandler.post(() -> {
                analysis = result;
                render(result);
                exportButton.setEnabled(true);
                setBusy(false, "Analyse passive terminée");
            });
        });
    }

    private void render(JSONObject result) {
        JSONObject archive = result.optJSONObject("archive");
        JSONArray dex = archive == null ? null : archive.optJSONArray("dexFiles");
        JSONArray libraries = archive == null ? null : archive.optJSONArray("nativeLibraries");
        JSONArray hits = archive == null ? null : archive.optJSONArray("keywordHits");

        String hash = result.optString("apkSha256", "indisponible");
        StringBuilder value = new StringBuilder();
        value.append("Version analyseur : ").append(BuildConfig.VERSION_NAME).append('\n');
        value.append("Paquet fournisseur : ").append(result.optString("package", VENDOR_PACKAGE)).append('\n');
        value.append("État              : ").append(result.optString("status", "?" )).append('\n');
        value.append("APK lisible       : ").append(result.optBoolean("sourceReadable", false)).append('\n');
        value.append("Taille APK        : ").append(result.optLong("apkSizeBytes", 0L)).append(" octets\n");
        value.append("SHA-256           : ").append(hash).append('\n');
        value.append("Entrées archive   : ").append(archive == null ? 0 : archive.optInt("entryCount", 0)).append('\n');
        value.append("Fichiers DEX      : ").append(dex == null ? 0 : dex.length()).append('\n');
        value.append("Bibliothèques .so : ").append(libraries == null ? 0 : libraries.length()).append('\n');
        value.append("Indices trouvés   : ").append(hits == null ? 0 : hits.length()).append('\n');
        value.append("APK copiée        : false\n");
        value.append("Code exécuté      : false\n");
        value.append("Port série ouvert : false\n");
        value.append("Écriture série    : 0 octet\n");

        if (hits != null && hits.length() > 0) {
            value.append("\nPremiers indices :\n");
            for (int index = 0; index < Math.min(12, hits.length()); index++) {
                JSONObject hit = hits.optJSONObject(index);
                if (hit == null) continue;
                value.append("- ").append(hit.optString("keyword", "?"))
                    .append(" · ").append(hit.optString("entry", "?"))
                    .append('\n');
            }
        }
        detailView.setText(value.toString());
    }

    private void exportAnalysis() {
        if (analysis == null) {
            Toast.makeText(this, "Lance d’abord l’analyse.", Toast.LENGTH_SHORT).show();
            return;
        }
        setBusy(true, "Création du rapport…");
        executor.execute(() -> {
            try {
                JSONObject report = new JSONObject();
                report.put("schemaVersion", 1);
                report.put("mode", "vendor_apk_passive_static_analysis");
                report.put("stationId", "DTA21269");
                report.put("analyzerVersion", BuildConfig.VERSION_NAME);
                report.put("generatedAt", System.currentTimeMillis());
                report.put("serialPortOpened", false);
                report.put("serialWrites", 0);
                report.put("physicalEjectionEnabled", false);
                report.put("vendorApkCopied", false);
                report.put("analysis", analysis);

                String filename = "DTA21269_VENDOR_ANALYSIS_"
                    + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date())
                    + ".json";
                Uri destination = saveDownload(filename, report.toString(2));
                mainHandler.post(() -> {
                    setBusy(false, "Rapport d’analyse exporté");
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
