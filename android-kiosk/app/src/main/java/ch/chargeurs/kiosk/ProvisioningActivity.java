package ch.chargeurs.kiosk;

import android.annotation.SuppressLint;
import android.app.Activity;
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

@SuppressLint("SetTextI18n")
public final class ProvisioningActivity extends Activity {
    private EditText pairingCodeInput;
    private Button activateButton;
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

        TextView title = text(getString(R.string.provision_title), 30, Color.WHITE);
        title.setGravity(Gravity.CENTER);
        content.addView(title, matchWrap(0, dp(18)));

        TextView help = text(getString(R.string.provision_help), 16, Color.rgb(190, 202, 226));
        help.setGravity(Gravity.CENTER);
        content.addView(help, matchWrap(0, dp(24)));

        pairingCodeInput = field(getString(R.string.pairing_code));
        pairingCodeInput.setSingleLine(true);
        pairingCodeInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        content.addView(pairingCodeInput, matchWrap(0, dp(24)));

        activateButton = new Button(this);
        activateButton.setText(R.string.activate);
        activateButton.setTextSize(17);
        activateButton.setAllCaps(false);
        activateButton.setOnClickListener(view -> provision());
        content.addView(activateButton, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(56)
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
            getString(R.string.reprovision_warning),
            13,
            Color.rgb(148, 163, 192)
        );
        warning.setGravity(Gravity.CENTER);
        content.addView(warning, matchWrap(0, dp(12)));

        return scroll;
    }

    private void provision() {
        String pairingCode = pairingCodeInput.getText().toString().trim();
        if (!pairingCode.matches("^kc_[A-Za-z0-9_-]{16,64}$")) {
            pairingCodeInput.setError(getString(R.string.invalid_pairing_code));
            return;
        }
        if (KioskConfigValidator.normalizeHttpsEndpoint(BuildConfig.ENROLLMENT_URL) == null) {
            Toast.makeText(this, R.string.enrollment_not_configured, Toast.LENGTH_LONG).show();
            return;
        }

        activateButton.setEnabled(false);
        activateButton.setText(R.string.enrollment_in_progress);
        executor.execute(() -> {
            try {
                EnrollmentResult result = EnrollmentClient.enroll(
                    BuildConfig.ENROLLMENT_URL,
                    pairingCode,
                    DeviceIdentity.getOrCreate(this),
                    BuildConfig.VERSION_NAME
                );
                if (!KioskConfigValidator.matchesPinnedBaseUrl(
                    result.config().baseUrl(), BuildConfig.KIOSK_PUBLIC_BASE_URL
                )) throw new IllegalStateException("KIOSK_ORIGIN_MISMATCH");
                if (!store.save(result.config())) throw new IllegalStateException("STORAGE_FAILED");
                runOnUiThread(() -> {
                    pairingCodeInput.setText("");
                    launchKiosk();
                });
            } catch (Exception error) {
                String message = enrollmentErrorMessage(error);
                runOnUiThread(() -> {
                    if (message.startsWith("Code refusé par le serveur")) {
                        // Never leave an expired/consumed code in the field:
                        // the operator must enter a freshly issued code.
                        pairingCodeInput.setText("");
                        pairingCodeInput.requestFocus();
                    }
                    activateButton.setEnabled(true);
                    activateButton.setText(R.string.activate);
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private String enrollmentErrorMessage(Exception error) {
        if (error instanceof UnknownHostException) return "Connexion Internet ou DNS indisponible.";
        if (error instanceof SocketTimeoutException) return "Le serveur d’appairage ne répond pas à temps.";

        String code = error.getMessage() == null ? "UNKNOWN_ERROR" : error.getMessage().trim();
        switch (code) {
            case "PAIRING_CODE_INVALID_OR_EXPIRED":
                return "Code refusé par le serveur : expiré, déjà utilisé ou non reconnu.";
            case "DEVICE_BOUND_TO_ANOTHER_STATION":
                return "Cette tablette est déjà liée à une autre borne. Révoquez-la dans le back-office.";
            case "PAIRING_CONFIGURATION_INVALID":
                return "Configuration de la borne incomplète côté serveur.";
            case "ENROLLMENT_UNAVAILABLE":
                return "Service d’appairage temporairement indisponible.";
            case "KIOSK_ORIGIN_MISMATCH":
                return "Le serveur a renvoyé une mauvaise adresse kiosk.";
            case "STORAGE_FAILED":
                return "Activation reçue, mais la tablette n’a pas pu enregistrer le token localement.";
            case "INVALID_ENROLLMENT_RESPONSE":
                return "Réponse d’activation incomplète reçue du serveur.";
            default:
                return BuildConfig.DEBUG
                    ? "Échec d’appairage — diagnostic : " + code
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
