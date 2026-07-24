package ch.chargeurs.kiosk;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ProvisioningActivity extends Activity {
    private EditText pairingCodeInput;
    private EditText stationIdInput;
    private Button activateButton;
    private TextView testTokenView;
    private Button copyTestTokenButton;
    private String requestedTestToken = "";
    private SecureConfigStore store;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new SecureConfigStore(this);
        KioskConfig existing = store.load();
        if (existing != null && KioskConfigValidator.matchesPinnedBaseUrl(
            existing.baseUrl(), BuildConfig.KIOSK_PUBLIC_BASE_URL
        )) {
            launchKiosk();
            return;
        }
        if (existing != null) store.clear();
        setContentView(buildView());
        if (BuildConfig.DEBUG) generateTestToken();
    }

    private ScrollView buildView() {
        int padding = dp(24);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(8, 17, 38));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(padding, padding * 2, padding, padding);
        scroll.addView(content, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView title = text(
            BuildConfig.DEBUG ? "Activation test Chargeurs.ch" : getString(R.string.provision_title),
            30,
            Color.WHITE
        );
        title.setGravity(Gravity.CENTER);
        content.addView(title, matchWrap(0, dp(18)));

        TextView help = text(
            BuildConfig.DEBUG
                ? "Sélectionnez la borne puis appuyez sur Activer. Aucun fichier, clé USB ou code créé dans le back-office n’est nécessaire pendant la phase de test."
                : getString(R.string.provision_help),
            16,
            Color.rgb(190, 202, 226)
        );
        help.setGravity(Gravity.CENTER);
        content.addView(help, matchWrap(0, dp(20)));

        if (BuildConfig.DEBUG) {
            stationIdInput = field("Identifiant de la borne — ex. DTA21269");
            stationIdInput.setSingleLine(true);
            stationIdInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
            content.addView(stationIdInput, matchWrap(0, dp(16)));

            LinearLayout tokenCard = new LinearLayout(this);
            tokenCard.setOrientation(LinearLayout.VERTICAL);
            tokenCard.setPadding(dp(16), dp(16), dp(16), dp(16));
            tokenCard.setBackgroundColor(Color.rgb(19, 34, 66));

            TextView tokenTitle = text("Token automatique de test", 16, Color.WHITE);
            tokenTitle.setGravity(Gravity.CENTER);
            tokenCard.addView(tokenTitle, matchWrap(0, dp(8)));

            TextView tokenHelp = text(
                "Le token est enregistré automatiquement sur la tablette et sur le serveur de test. Le bouton Copier reste disponible pour contrôle ou dépannage.",
                13,
                Color.rgb(190, 202, 226)
            );
            tokenHelp.setGravity(Gravity.CENTER);
            tokenCard.addView(tokenHelp, matchWrap(0, dp(12)));

            testTokenView = text("Génération…", 13, Color.WHITE);
            testTokenView.setTextIsSelectable(true);
            testTokenView.setGravity(Gravity.CENTER);
            testTokenView.setPadding(dp(10), dp(12), dp(10), dp(12));
            testTokenView.setBackgroundColor(Color.rgb(8, 17, 38));
            tokenCard.addView(testTokenView, matchWrap(0, dp(10)));

            copyTestTokenButton = new Button(this);
            copyTestTokenButton.setText("Copier le token");
            copyTestTokenButton.setAllCaps(false);
            copyTestTokenButton.setEnabled(false);
            copyTestTokenButton.setOnClickListener(view -> copyTestToken());
            tokenCard.addView(copyTestTokenButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(52)
            ));

            Button regenerateButton = new Button(this);
            regenerateButton.setText("Créer un nouveau token");
            regenerateButton.setAllCaps(false);
            regenerateButton.setOnClickListener(view -> generateTestToken());
            LinearLayout.LayoutParams regenerateParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(52)
            );
            regenerateParams.setMargins(0, dp(8), 0, 0);
            tokenCard.addView(regenerateButton, regenerateParams);

            content.addView(tokenCard, matchWrap(0, dp(20)));
        } else {
            pairingCodeInput = field(getString(R.string.pairing_code));
            pairingCodeInput.setSingleLine(true);
            pairingCodeInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
            content.addView(pairingCodeInput, matchWrap(0, dp(24)));
        }

        activateButton = new Button(this);
        activateButton.setText(BuildConfig.DEBUG ? "Activer cette borne" : getString(R.string.activate));
        activateButton.setTextSize(17);
        activateButton.setAllCaps(false);
        activateButton.setOnClickListener(view -> provision());
        content.addView(activateButton, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(58)
        ));

        Button diagnosticButton = new Button(this);
        diagnosticButton.setText("Diagnostic matériel automatique");
        diagnosticButton.setAllCaps(false);
        diagnosticButton.setOnClickListener(view -> startActivity(
            new Intent(this, HardwareDiagnosticActivity.class)
        ));
        LinearLayout.LayoutParams diagnosticParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(56)
        );
        diagnosticParams.setMargins(0, dp(10), 0, 0);
        content.addView(diagnosticButton, diagnosticParams);

        TextView warning = text(
            BuildConfig.DEBUG
                ? "Mode temporaire : uniquement pour les bornes pilotes de staging. Le token expire après 7 jours."
                : getString(R.string.reprovision_warning),
            13,
            Color.rgb(148, 163, 192)
        );
        warning.setGravity(Gravity.CENTER);
        content.addView(warning, matchWrap(0, dp(12)));

        return scroll;
    }

    private void generateTestToken() {
        if (!BuildConfig.DEBUG || testTokenView == null) return;
        requestedTestToken = TestKioskToken.generate();
        testTokenView.setText(requestedTestToken);
        if (copyTestTokenButton != null) copyTestTokenButton.setEnabled(true);
    }

    private void copyTestToken() {
        if (!TestKioskToken.isValid(requestedTestToken)) return;
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) return;
        clipboard.setPrimaryClip(ClipData.newPlainText("Chargeurs kiosk test token", requestedTestToken));
        Toast.makeText(this, "Token copié.", Toast.LENGTH_LONG).show();
    }

    private void provision() {
        if (KioskConfigValidator.normalizeHttpsEndpoint(BuildConfig.ENROLLMENT_URL) == null) {
            Toast.makeText(this, R.string.enrollment_not_configured, Toast.LENGTH_LONG).show();
            return;
        }

        final String stationId;
        final String pairingCode;
        if (BuildConfig.DEBUG) {
            stationId = stationIdInput == null ? "" : stationIdInput.getText().toString().trim().toUpperCase();
            pairingCode = "";
            if (!KioskConfigValidator.isValidStationId(stationId)) {
                stationIdInput.setError("Saisissez l’identifiant exact, par exemple DTA21269.");
                return;
            }
            if (!TestKioskToken.isValid(requestedTestToken)) generateTestToken();
        } else {
            stationId = "";
            pairingCode = pairingCodeInput == null ? "" : pairingCodeInput.getText().toString().trim();
            if (!pairingCode.matches("^kc_[A-Za-z0-9_-]{16,64}$")) {
                pairingCodeInput.setError(getString(R.string.invalid_pairing_code));
                return;
            }
        }

        activateButton.setEnabled(false);
        activateButton.setText(R.string.enrollment_in_progress);
        executor.execute(() -> {
            try {
                EnrollmentResult result = BuildConfig.DEBUG
                    ? EnrollmentClient.selfEnrollDiagnostic(
                        BuildConfig.ENROLLMENT_URL,
                        stationId,
                        DeviceIdentity.getOrCreate(this),
                        BuildConfig.VERSION_NAME,
                        requestedTestToken
                    )
                    : EnrollmentClient.enrollWithPairing(
                        BuildConfig.ENROLLMENT_URL,
                        pairingCode,
                        DeviceIdentity.getOrCreate(this),
                        BuildConfig.VERSION_NAME
                    );
                if (!KioskConfigValidator.matchesPinnedBaseUrl(
                    result.config().baseUrl(), BuildConfig.KIOSK_PUBLIC_BASE_URL
                )) throw new IllegalStateException("KIOSK_ORIGIN_MISMATCH");
                if (!store.save(result.config())) throw new IllegalStateException("STORAGE_FAILED");
                runOnUiThread(this::launchKiosk);
            } catch (Exception error) {
                String message = enrollmentErrorMessage(error);
                runOnUiThread(() -> {
                    activateButton.setEnabled(true);
                    activateButton.setText(BuildConfig.DEBUG ? "Activer cette borne" : getString(R.string.activate));
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private String enrollmentErrorMessage(Exception error) {
        if (error instanceof UnknownHostException) return "Connexion Internet ou DNS indisponible.";
        if (error instanceof SocketTimeoutException) return "Le serveur d’activation ne répond pas à temps.";

        String code = error.getMessage() == null ? "UNKNOWN_ERROR" : error.getMessage().trim();
        switch (code) {
            case "PAIRING_CODE_INVALID_OR_EXPIRED":
                return "Code refusé par le serveur : expiré, déjà utilisé ou non reconnu.";
            case "DEVICE_BOUND_TO_ANOTHER_STATION":
                return "Cette tablette est déjà liée à une autre borne de test.";
            case "TEST_STATION_NOT_ALLOWED":
                return "Cette borne n’est pas encore autorisée comme borne pilote de test.";
            case "TEST_STATION_ORGANIZATION_MISSING":
                return "La borne de test n’est pas complètement configurée côté serveur.";
            case "TEST_SELF_ENROLLMENT_NOT_ALLOWED":
                return "L’auto-activation de test est désactivée ou cette APK n’est pas la version diagnostic.";
            case "TEST_ENROLLMENT_UNAVAILABLE":
                return "Le service d’auto-activation de test n’est pas encore déployé.";
            case "KIOSK_ORIGIN_MISMATCH":
                return "Le serveur a renvoyé une mauvaise adresse kiosk.";
            case "STORAGE_FAILED":
                return "Activation reçue, mais la tablette n’a pas pu enregistrer le token localement.";
            case "INVALID_ENROLLMENT_RESPONSE":
                return "Réponse d’activation incomplète reçue du serveur.";
            case "TEST_TOKEN_NOT_ACCEPTED":
                return "Le serveur n’a pas confirmé le token créé sur cette tablette.";
            default:
                return BuildConfig.DEBUG
                    ? "Échec d’activation — diagnostic : " + code
                    : getString(R.string.enrollment_failed);
        }
    }

    private void launchKiosk() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(intent);
        finish();
    }

    private EditText field(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.rgb(148, 163, 192));
        input.setBackgroundColor(Color.rgb(19, 34, 66));
        input.setPadding(dp(16), dp(4), dp(16), dp(4));
        return input;
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
