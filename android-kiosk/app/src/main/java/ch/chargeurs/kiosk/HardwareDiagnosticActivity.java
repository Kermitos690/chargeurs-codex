package ch.chargeurs.kiosk;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class HardwareDiagnosticActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private TextView output;
    private Button copyButton;
    private Button uploadButton;
    private String report = "";
    private JSONObject collectedReport;
    private KioskConfig config;
    private String shadowEndpoint;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        config = new SecureConfigStore(this).load();
        shadowEndpoint = ShadowTelemetryClient.deriveEndpoint(BuildConfig.ENROLLMENT_URL);
        setContentView(buildView());
        runDiagnostic();
    }

    private ScrollView buildView() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(8, 17, 38));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(24), dp(24), dp(24));
        scroll.addView(content, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView title = new TextView(this);
        title.setText("Diagnostic matériel et mode shadow DTA");
        title.setTextSize(25);
        title.setTextColor(Color.WHITE);
        title.setGravity(Gravity.CENTER);
        content.addView(title, matchWrap(dp(8), dp(12)));

        TextView help = new TextView(this);
        help.setText(
            "Lecture uniquement : ports série, USB, pilotes, réseau, processus, firmware Android "
                + "et présence de l’APK fournisseur. Aucune trame ni commande n’est envoyée à la borne."
        );
        help.setTextSize(14);
        help.setTextColor(Color.rgb(190, 202, 226));
        help.setGravity(Gravity.CENTER);
        content.addView(help, matchWrap(0, dp(16)));

        output = new TextView(this);
        output.setText("Analyse en cours…");
        output.setTextIsSelectable(true);
        output.setTextSize(12);
        output.setTextColor(Color.WHITE);
        output.setBackgroundColor(Color.rgb(19, 34, 66));
        output.setPadding(dp(14), dp(14), dp(14), dp(14));
        content.addView(output, matchWrap(0, dp(16)));

        copyButton = new Button(this);
        copyButton.setText("Copier tout le diagnostic");
        copyButton.setEnabled(false);
        copyButton.setOnClickListener(view -> copyReport());
        content.addView(copyButton, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(54)
        ));

        uploadButton = new Button(this);
        uploadButton.setText(config != null && config.isValid()
            ? "Envoyer au serveur Chargeurs.ch"
            : "Activation requise pour l’envoi");
        uploadButton.setEnabled(false);
        uploadButton.setOnClickListener(view -> uploadReport());
        LinearLayout.LayoutParams uploadParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(54)
        );
        uploadParams.setMargins(0, dp(10), 0, 0);
        content.addView(uploadButton, uploadParams);

        Button rerunButton = new Button(this);
        rerunButton.setText("Relancer le diagnostic");
        rerunButton.setOnClickListener(view -> runDiagnostic());
        LinearLayout.LayoutParams rerunParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(54)
        );
        rerunParams.setMargins(0, dp(10), 0, 0);
        content.addView(rerunButton, rerunParams);

        Button closeButton = new Button(this);
        closeButton.setText("Retour");
        closeButton.setOnClickListener(view -> finish());
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(54)
        );
        closeParams.setMargins(0, dp(10), 0, 0);
        content.addView(closeButton, closeParams);

        return scroll;
    }

    private void runDiagnostic() {
        output.setText("Analyse en cours…");
        copyButton.setEnabled(false);
        uploadButton.setEnabled(false);
        collectedReport = null;
        executor.execute(() -> {
            String formatted;
            JSONObject collected = null;
            try {
                collected = HardwareDiagnosticCollector.collect(this);
                formatted = collected.toString(2);
            } catch (Exception error) {
                formatted = "{\n  \"diagnosticError\": \"" + error.getClass().getSimpleName()
                    + "\",\n  \"safeReadOnly\": true\n}";
            }
            final JSONObject resultObject = collected;
            final String result = formatted;
            runOnUiThread(() -> {
                collectedReport = resultObject;
                report = result;
                output.setText(result);
                copyButton.setEnabled(true);
                uploadButton.setEnabled(
                    collectedReport != null
                        && config != null
                        && config.isValid()
                        && shadowEndpoint != null
                );
            });
        });
    }

    private void uploadReport() {
        if (collectedReport == null || config == null || !config.isValid() || shadowEndpoint == null) {
            Toast.makeText(this, "La borne doit être activée avant l’envoi.", Toast.LENGTH_LONG).show();
            return;
        }

        uploadButton.setEnabled(false);
        uploadButton.setText("Envoi sécurisé en cours…");
        final JSONObject snapshot = collectedReport;
        final long sequence = System.currentTimeMillis();
        executor.execute(() -> {
            try {
                JSONObject receipt = ShadowTelemetryClient.upload(
                    shadowEndpoint,
                    config,
                    DeviceIdentity.getOrCreate(this),
                    BuildConfig.VERSION_NAME,
                    sequence,
                    snapshot
                );
                String receiptText = receipt.toString(2);
                runOnUiThread(() -> {
                    report = report + "\n\n--- Réception serveur Chargeurs.ch ---\n" + receiptText;
                    output.setText(report);
                    uploadButton.setText("Observation envoyée ✓");
                    uploadButton.setEnabled(true);
                    Toast.makeText(this, "Observation shadow enregistrée.", Toast.LENGTH_LONG).show();
                });
            } catch (Exception error) {
                String code = error.getMessage() == null
                    ? error.getClass().getSimpleName()
                    : error.getMessage();
                runOnUiThread(() -> {
                    uploadButton.setText("Réessayer l’envoi");
                    uploadButton.setEnabled(true);
                    Toast.makeText(this, "Échec de l’envoi : " + code, Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void copyReport() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null || report.isEmpty()) return;
        clipboard.setPrimaryClip(ClipData.newPlainText("Chargeurs DTA diagnostic", report));
        Toast.makeText(this, "Diagnostic copié", Toast.LENGTH_LONG).show();
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
