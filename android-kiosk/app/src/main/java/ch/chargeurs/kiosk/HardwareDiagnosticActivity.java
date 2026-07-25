package ch.chargeurs.kiosk;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class HardwareDiagnosticActivity extends Activity {
    private static final String PREFS_NAME = "dta_qualification_campaign";
    private static final String KEY_CAMPAIGN_ID = "campaign_id";
    private static final String KEY_OBSERVATION_NUMBER = "observation_number";
    private static final String[] SCENARIOS = new String[]{
        "01 — ChargeNow connecté, borne au repos",
        "02 — Avant location fournisseur autorisée",
        "03 — Après éjection fournisseur autorisée",
        "04 — Après retour de la batterie",
        "05 — Réseau coupé",
        "06 — Réseau rétabli",
        "07 — APK fournisseur arrêtée",
        "08 — APK fournisseur relancée",
        "09 — Tablette redémarrée"
    };

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private TextView output;
    private TextView campaignStatus;
    private Spinner scenarioSpinner;
    private Button copyButton;
    private Button uploadButton;
    private String report = "";
    private JSONObject collectedReport;
    private KioskConfig config;
    private String shadowEndpoint;
    private String campaignId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        config = new SecureConfigStore(this).load();
        shadowEndpoint = ShadowTelemetryClient.deriveEndpoint(BuildConfig.ENROLLMENT_URL);
        campaignId = loadOrCreateCampaignId();
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
        title.setText("Qualification DTA21269 — shadow avancé");
        title.setTextSize(25);
        title.setTextColor(Color.WHITE);
        title.setGravity(Gravity.CENTER);
        content.addView(title, matchWrap(dp(8), dp(12)));

        TextView help = new TextView(this);
        help.setText(
            "Lecture uniquement : propriétaire du port série, paramètres du port, compteurs du processus fournisseur, "
                + "USB, réseau et système. L’APK Chargeurs.ch n’ouvre pas /dev/ttyS1 et n’écrit aucune trame."
        );
        help.setTextSize(14);
        help.setTextColor(Color.rgb(190, 202, 226));
        help.setGravity(Gravity.CENTER);
        content.addView(help, matchWrap(0, dp(12)));

        campaignStatus = new TextView(this);
        campaignStatus.setText(campaignLabel());
        campaignStatus.setTextSize(13);
        campaignStatus.setTextColor(Color.rgb(119, 255, 184));
        campaignStatus.setGravity(Gravity.CENTER);
        content.addView(campaignStatus, matchWrap(0, dp(10)));

        scenarioSpinner = new Spinner(this);
        ArrayAdapter<String> scenarioAdapter = new ArrayAdapter<>(
            this,
            android.R.layout.simple_spinner_item,
            SCENARIOS
        );
        scenarioAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        scenarioSpinner.setAdapter(scenarioAdapter);
        content.addView(scenarioSpinner, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(54)
        ));

        output = new TextView(this);
        output.setText("Analyse en cours…");
        output.setTextIsSelectable(true);
        output.setTextSize(12);
        output.setTextColor(Color.WHITE);
        output.setBackgroundColor(Color.rgb(19, 34, 66));
        output.setPadding(dp(14), dp(14), dp(14), dp(14));
        content.addView(output, matchWrap(dp(12), dp(16)));

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
            ? "Envoyer l’observation de campagne"
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
        rerunButton.setText("Capturer le scénario sélectionné");
        rerunButton.setOnClickListener(view -> runDiagnostic());
        LinearLayout.LayoutParams rerunParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(54)
        );
        rerunParams.setMargins(0, dp(10), 0, 0);
        content.addView(rerunButton, rerunParams);

        Button newCampaignButton = new Button(this);
        newCampaignButton.setText("Commencer une nouvelle campagne");
        newCampaignButton.setOnClickListener(view -> resetCampaign());
        LinearLayout.LayoutParams campaignParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(54)
        );
        campaignParams.setMargins(0, dp(10), 0, 0);
        content.addView(newCampaignButton, campaignParams);

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
        final String selectedScenario = selectedScenario();
        final long observationNumber = nextObservationNumber();
        output.setText("Analyse passive en cours…");
        copyButton.setEnabled(false);
        uploadButton.setEnabled(false);
        collectedReport = null;
        executor.execute(() -> {
            String formatted;
            JSONObject collected = null;
            try {
                collected = HardwareDiagnosticCollector.collect(this);
                JSONObject qualification = new JSONObject();
                qualification.put("campaignId", campaignId);
                qualification.put("observationNumber", observationNumber);
                qualification.put("scenario", selectedScenario);
                qualification.put("stationId", config == null ? "" : config.stationId());
                qualification.put("capturedAt", System.currentTimeMillis());
                qualification.put("mode", "shadow_passive_serial_discovery");
                qualification.put("readOnly", true);
                collected.put("qualificationCampaign", qualification);
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
                uploadButton.setText(config != null && config.isValid()
                    ? "Envoyer l’observation de campagne"
                    : "Activation requise pour l’envoi");
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
                    Toast.makeText(this, "Observation de qualification enregistrée.", Toast.LENGTH_LONG).show();
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

    private String loadOrCreateCampaignId() {
        SharedPreferences preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String stored = preferences.getString(KEY_CAMPAIGN_ID, "");
        if (stored != null && !stored.isEmpty()) return stored;
        String created = UUID.randomUUID().toString();
        preferences.edit()
            .putString(KEY_CAMPAIGN_ID, created)
            .putLong(KEY_OBSERVATION_NUMBER, 0L)
            .apply();
        return created;
    }

    private long nextObservationNumber() {
        SharedPreferences preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        long next = preferences.getLong(KEY_OBSERVATION_NUMBER, 0L) + 1L;
        preferences.edit().putLong(KEY_OBSERVATION_NUMBER, next).apply();
        return next;
    }

    private void resetCampaign() {
        campaignId = UUID.randomUUID().toString();
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
            .putString(KEY_CAMPAIGN_ID, campaignId)
            .putLong(KEY_OBSERVATION_NUMBER, 0L)
            .apply();
        campaignStatus.setText(campaignLabel());
        scenarioSpinner.setSelection(0);
        runDiagnostic();
        Toast.makeText(this, "Nouvelle campagne créée.", Toast.LENGTH_LONG).show();
    }

    private String campaignLabel() {
        String shortId = campaignId == null || campaignId.length() < 8
            ? campaignId
            : campaignId.substring(0, 8);
        return "Campagne : " + shortId + " — aucune commande matérielle";
    }

    private String selectedScenario() {
        Object selected = scenarioSpinner == null ? null : scenarioSpinner.getSelectedItem();
        return selected == null ? SCENARIOS[0] : selected.toString();
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
