package ch.chargeurs.kiosk;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class SimpleQualificationActivity extends Activity {
    private static final String STATION_ID = "DTA21269";
    private static final String VENDOR_PACKAGE = "com.szbjkj.bajietouchpower";
    private static final String[] STEP_KEYS = {"rest", "after_ejection", "after_return"};
    private static final String[] STEP_LABELS = {
        "Borne au repos",
        "Après sortie d’une batterie",
        "Après retour de la batterie"
    };

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private TextView status;
    private Button restButton;
    private Button ejectionButton;
    private Button returnButton;
    private Button exportButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildView());
        refreshState();
    }

    private ScrollView buildView() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(8, 17, 38));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(28), dp(34), dp(28), dp(28));
        scroll.addView(content, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView title = text("Test simple Chargeurs.ch", 30, Color.WHITE);
        title.setGravity(Gravity.CENTER);
        content.addView(title, matchWrap(0, dp(10)));

        TextView subtitle = text(
            "Borne " + STATION_ID + " — trois captures, puis un seul rapport. "
                + "Aucune activation serveur et aucune commande matérielle ne sont utilisées.",
            16,
            Color.rgb(190, 202, 226)
        );
        subtitle.setGravity(Gravity.CENTER);
        content.addView(subtitle, matchWrap(0, dp(18)));

        status = text("Préparation…", 15, Color.rgb(119, 255, 184));
        status.setGravity(Gravity.CENTER);
        status.setPadding(dp(12), dp(12), dp(12), dp(12));
        status.setBackgroundColor(Color.rgb(19, 34, 66));
        content.addView(status, matchWrap(0, dp(18)));

        restButton = actionButton("1. Capturer la borne au repos", () -> captureStep(0));
        content.addView(restButton, fullButton());

        Button vendorButton = actionButton("Ouvrir l’application fournisseur", this::openVendorApp);
        LinearLayout.LayoutParams vendorParams = fullButton();
        vendorParams.setMargins(0, dp(10), 0, 0);
        content.addView(vendorButton, vendorParams);

        TextView instruction = text(
            "Dans l’application fournisseur, effectuez une seule location de test. "
                + "Revenez ensuite ici avec le bouton des applications récentes.",
            14,
            Color.rgb(190, 202, 226)
        );
        instruction.setGravity(Gravity.CENTER);
        content.addView(instruction, matchWrap(dp(12), dp(12)));

        ejectionButton = actionButton("2. Capturer après la sortie", () -> captureStep(1));
        content.addView(ejectionButton, fullButton());

        TextView returnHelp = text(
            "Remettez exactement la même batterie dans la borne, attendez son verrouillage, puis continuez.",
            14,
            Color.rgb(190, 202, 226)
        );
        returnHelp.setGravity(Gravity.CENTER);
        content.addView(returnHelp, matchWrap(dp(12), dp(12)));

        returnButton = actionButton("3. Capturer après le retour", () -> captureStep(2));
        content.addView(returnButton, fullButton());

        exportButton = actionButton("Exporter et envoyer le rapport complet", this::exportReport);
        LinearLayout.LayoutParams exportParams = fullButton();
        exportParams.setMargins(0, dp(18), 0, 0);
        content.addView(exportButton, exportParams);

        Button resetButton = actionButton("Recommencer le test", this::resetTest);
        LinearLayout.LayoutParams resetParams = fullButton();
        resetParams.setMargins(0, dp(10), 0, 0);
        content.addView(resetButton, resetParams);

        return scroll;
    }

    private void captureStep(int index) {
        setBusy(true, "Capture de « " + STEP_LABELS[index] + " » en cours…");
        executor.execute(() -> {
            try {
                JSONObject report = HardwareDiagnosticCollector.collect(this);
                JSONObject simpleTest = new JSONObject();
                simpleTest.put("stationId", STATION_ID);
                simpleTest.put("step", STEP_KEYS[index]);
                simpleTest.put("label", STEP_LABELS[index]);
                simpleTest.put("capturedAt", System.currentTimeMillis());
                simpleTest.put("appVersion", BuildConfig.VERSION_NAME);
                simpleTest.put("safeReadOnly", true);
                report.put("simpleQualification", simpleTest);
                writeInternal(stepFile(index), report.toString(2));
                runOnUiThread(() -> {
                    Toast.makeText(this, "Capture enregistrée.", Toast.LENGTH_LONG).show();
                    setBusy(false, "Capture terminée : " + STEP_LABELS[index]);
                    refreshState();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    setBusy(false, "Échec de la capture : " + error.getClass().getSimpleName());
                    Toast.makeText(this, "La capture a échoué.", Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void openVendorApp() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(VENDOR_PACKAGE);
        if (launch == null) {
            Toast.makeText(this, "Application fournisseur introuvable.", Toast.LENGTH_LONG).show();
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(launch);
    }

    private void exportReport() {
        if (!allStepsComplete()) {
            Toast.makeText(this, "Effectuez d’abord les trois captures.", Toast.LENGTH_LONG).show();
            return;
        }
        setBusy(true, "Création du rapport unique…");
        executor.execute(() -> {
            try {
                JSONObject bundle = new JSONObject();
                bundle.put("schemaVersion", 1);
                bundle.put("stationId", STATION_ID);
                bundle.put("generatedAt", System.currentTimeMillis());
                bundle.put("appVersion", BuildConfig.VERSION_NAME);
                bundle.put("safeReadOnly", true);
                JSONArray observations = new JSONArray();
                for (int i = 0; i < STEP_KEYS.length; i++) {
                    observations.put(new JSONObject(readInternal(stepFile(i))));
                }
                bundle.put("observations", observations);

                String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
                String filename = "DTA21269-rapport-simple-" + stamp + ".json";
                Uri uri = saveToDownloads(filename, bundle.toString(2));
                runOnUiThread(() -> {
                    setBusy(false, "Rapport créé dans Téléchargements/Chargeurs.");
                    if (uri != null) shareReport(uri, filename);
                    else Toast.makeText(this, "Rapport enregistré dans les téléchargements de l’application.", Toast.LENGTH_LONG).show();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    setBusy(false, "Échec de l’export : " + error.getClass().getSimpleName());
                    Toast.makeText(this, "Impossible de créer le rapport.", Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private Uri saveToDownloads(String filename, String content) throws Exception {
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
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.Downloads.IS_PENDING, 0);
            getContentResolver().update(uri, ready, null, null);
            return uri;
        }

        File directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (directory == null) throw new IllegalStateException("DOWNLOAD_DIRECTORY_UNAVAILABLE");
        File file = new File(directory, filename);
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
        }
        return null;
    }

    private void shareReport(Uri uri, String filename) {
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("application/json");
        share.putExtra(Intent.EXTRA_STREAM, uri);
        share.putExtra(Intent.EXTRA_SUBJECT, "Rapport simple " + STATION_ID);
        share.putExtra(Intent.EXTRA_TEXT, "Rapport de qualification simple de la borne " + STATION_ID + ".");
        share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(share, "Envoyer " + filename));
    }

    private void resetTest() {
        for (int i = 0; i < STEP_KEYS.length; i++) {
            File file = new File(getFilesDir(), stepFile(i));
            if (file.exists()) file.delete();
        }
        refreshState();
        Toast.makeText(this, "Le test a été remis à zéro.", Toast.LENGTH_LONG).show();
    }

    private void refreshState() {
        boolean rest = exists(stepFile(0));
        boolean ejection = exists(stepFile(1));
        boolean returned = exists(stepFile(2));
        restButton.setEnabled(true);
        ejectionButton.setEnabled(rest);
        returnButton.setEnabled(rest && ejection);
        exportButton.setEnabled(rest && ejection && returned);
        status.setText(
            "Repos " + mark(rest)
                + "   •   Sortie " + mark(ejection)
                + "   •   Retour " + mark(returned)
        );
    }

    private boolean allStepsComplete() {
        return exists(stepFile(0)) && exists(stepFile(1)) && exists(stepFile(2));
    }

    private boolean exists(String name) {
        return new File(getFilesDir(), name).isFile();
    }

    private String stepFile(int index) {
        return "simple-qualification-" + STEP_KEYS[index] + ".json";
    }

    private void writeInternal(String name, String content) throws Exception {
        try (FileOutputStream output = openFileOutput(name, MODE_PRIVATE)) {
            output.write(content.getBytes(StandardCharsets.UTF_8));
        }
    }

    private String readInternal(String name) throws Exception {
        File file = new File(getFilesDir(), name);
        byte[] bytes = new byte[(int) file.length()];
        try (FileInputStream input = new FileInputStream(file)) {
            int offset = 0;
            while (offset < bytes.length) {
                int count = input.read(bytes, offset, bytes.length - offset);
                if (count < 0) break;
                offset += count;
            }
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private void setBusy(boolean busy, String message) {
        restButton.setEnabled(!busy);
        ejectionButton.setEnabled(!busy && exists(stepFile(0)));
        returnButton.setEnabled(!busy && exists(stepFile(0)) && exists(stepFile(1)));
        exportButton.setEnabled(!busy && allStepsComplete());
        status.setText(message);
    }

    private String mark(boolean done) {
        return done ? "✓" : "—";
    }

    private Button actionButton(String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(17);
        button.setAllCaps(false);
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private LinearLayout.LayoutParams fullButton() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58));
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private LinearLayout.LayoutParams matchWrap(int top, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, top, 0, bottom);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
