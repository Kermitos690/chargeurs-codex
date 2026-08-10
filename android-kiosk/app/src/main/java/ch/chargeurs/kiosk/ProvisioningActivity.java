package ch.chargeurs.kiosk;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.GridLayout;
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
    private final TextView[] pairingCodeCells = new TextView[6];
    private Button activateButton;
    private TextView secureStorageStatus;
    private SecureConfigStore store;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final StringBuilder activationCode = new StringBuilder(6);
    private boolean storageReady;
    private boolean storageCheckInFlight;
    private boolean enrollmentInFlight;

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
        KioskVisuals.applyKioskWindow(this);
        setContentView(buildView());
        checkSecureStorageBeforeEnrollment();
    }

    private FrameLayout buildView() {
        int padding = dp(24);
        FrameLayout root = new FrameLayout(this);
        root.addView(new KioskAmbientBackground(this), new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(padding, padding, padding, padding);
        content.setBackground(KioskVisuals.glassPanel(dp(28)));
        scroll.addView(content, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        FrameLayout.LayoutParams scrollParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        scrollParams.gravity = Gravity.CENTER;
        scrollParams.setMargins(dp(20), dp(20), dp(20), dp(20));
        root.addView(scroll, scrollParams);

        TextView brand = KioskVisuals.brandText(this, 24);
        brand.setGravity(Gravity.CENTER);
        content.addView(brand, matchWrap(dp(8), dp(22)));

        TextView title = text(getString(R.string.provision_title), 30, KioskVisuals.WHITE);
        title.setGravity(Gravity.CENTER);
        content.addView(title, matchWrap(0, dp(18)));

        TextView help = text(getString(R.string.provision_help), 16, KioskVisuals.MUTED);
        help.setGravity(Gravity.CENTER);
        content.addView(help, matchWrap(0, dp(24)));

        secureStorageStatus = text(getString(R.string.secure_storage_checking), 14, KioskVisuals.MUTED);
        secureStorageStatus.setGravity(Gravity.CENTER);
        content.addView(secureStorageStatus, matchWrap(0, dp(16)));

        LinearLayout codeCells = new LinearLayout(this);
        codeCells.setGravity(Gravity.CENTER);
        for (int index = 0; index < pairingCodeCells.length; index += 1) {
            TextView cell = text("", 28, KioskVisuals.WHITE);
            cell.setGravity(Gravity.CENTER);
            cell.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            cell.setContentDescription(getString(R.string.pairing_code));
            LinearLayout.LayoutParams cellParams = new LinearLayout.LayoutParams(0, dp(58), 1f);
            cellParams.setMargins(index == 0 ? 0 : dp(5), 0, 0, 0);
            codeCells.addView(cell, cellParams);
            pairingCodeCells[index] = cell;
        }
        content.addView(codeCells, matchWrap(0, dp(18)));
        updateCodeDisplay();

        GridLayout keypad = new GridLayout(this);
        keypad.setColumnCount(3);
        keypad.setUseDefaultMargins(false);
        for (String key : new String[] { "1", "2", "3", "4", "5", "6", "7", "8", "9", "Effacer", "0", "⌫" }) {
            Button button = new Button(this);
            button.setText(key);
            button.setTextColor(KioskVisuals.WHITE);
            button.setTextSize(key.length() == 1 ? 24 : 14);
            button.setAllCaps(false);
            button.setBackground(KioskVisuals.secondaryButton(dp(18)));
            button.setOnClickListener(view -> onKeypadKey(key));
            GridLayout.LayoutParams params = new GridLayout.LayoutParams();
            params.width = 0;
            params.height = dp(62);
            params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
            params.setMargins(dp(4), dp(4), dp(4), dp(4));
            keypad.addView(button, params);
        }
        content.addView(keypad, matchWrap(0, dp(18)));

        activateButton = new Button(this);
        activateButton.setText(R.string.activate);
        activateButton.setTextColor(KioskVisuals.WHITE);
        activateButton.setTextSize(17);
        activateButton.setAllCaps(false);
        activateButton.setBackground(KioskVisuals.primaryButton(dp(28)));
        activateButton.setOnClickListener(view -> provision());
        activateButton.setEnabled(false);
        content.addView(activateButton, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(56)
        ));

        Button diagnosticButton = new Button(this);
        diagnosticButton.setText("Diagnostic matériel automatique");
        diagnosticButton.setTextColor(KioskVisuals.WHITE);
        diagnosticButton.setAllCaps(false);
        diagnosticButton.setBackground(KioskVisuals.secondaryButton(dp(28)));
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
            KioskVisuals.MUTED
        );
        warning.setGravity(Gravity.CENTER);
        content.addView(warning, matchWrap(0, dp(12)));

        KioskVisuals.fadeIn(content);
        return root;
    }

    private void checkSecureStorageBeforeEnrollment() {
        storageReady = false;
        storageCheckInFlight = true;
        updateActivateButton();
        executor.execute(() -> {
            SecureConfigStore.StorageHealth health = store.prepareForEnrollment();
            new LocalAuditLog(this).record("kiosk.secure_storage.preflight", JsonObjects.of(
                "ready", health.isReady(),
                "status", health.code(),
                "repaired", health.wasRepaired()
            ));
            runOnUiThread(() -> {
                storageCheckInFlight = false;
                storageReady = health.isReady();
                if (health.isReady()) {
                    secureStorageStatus.setText(health.wasRepaired()
                        ? getString(R.string.secure_storage_repaired)
                        : getString(R.string.secure_storage_ready));
                    secureStorageStatus.setTextColor(KioskVisuals.MUTED);
                } else {
                    secureStorageStatus.setText(getString(R.string.secure_storage_unavailable, health.code()));
                    secureStorageStatus.setTextColor(KioskVisuals.WARNING);
                }
                updateActivateButton();
            });
        });
    }

    private void provision() {
        String pairingCode = activationCode.toString();
        if (!EnrollmentClient.isValidPairingCode(pairingCode)) {
            Toast.makeText(this, R.string.invalid_pairing_code, Toast.LENGTH_LONG).show();
            return;
        }
        if (KioskConfigValidator.normalizeHttpsEndpoint(BuildConfig.ENROLLMENT_URL) == null) {
            Toast.makeText(this, R.string.enrollment_not_configured, Toast.LENGTH_LONG).show();
            return;
        }
        if (!storageReady) {
            if (storageCheckInFlight) {
                Toast.makeText(this, "Vérification du stockage sécurisé en cours…", Toast.LENGTH_LONG).show();
            } else {
                Toast.makeText(this, R.string.secure_storage_must_be_ready, Toast.LENGTH_LONG).show();
                checkSecureStorageBeforeEnrollment();
            }
            return;
        }

        enrollmentInFlight = true;
        updateActivateButton();
        activateButton.setText(R.string.enrollment_in_progress);
        executor.execute(() -> {
            try {
                // Repeat the preflight immediately before the request. A code
                // is one-time, so we never submit it to the server while this
                // device cannot prove that it can retain the resulting token.
                SecureConfigStore.StorageHealth health = store.prepareForEnrollment();
                if (!health.isReady()) throw new IllegalStateException("STORAGE_PREFLIGHT_" + health.code());
                EnrollmentResult result = EnrollmentClient.enroll(
                    BuildConfig.ENROLLMENT_URL,
                    pairingCode,
                    DeviceIdentity.getOrCreate(this),
                    BuildConfig.VERSION_NAME
                );
                if (!KioskConfigValidator.matchesPinnedBaseUrl(
                    result.config().baseUrl(), BuildConfig.KIOSK_PUBLIC_BASE_URL
                )) throw new IllegalStateException("KIOSK_ORIGIN_MISMATCH");
                SecureConfigStore.SaveResult saved = store.save(result.config());
                if (!saved.isSaved()) throw new EnrollmentStorageWriteException(saved.code());
                runOnUiThread(() -> {
                    clearCode();
                    launchKiosk();
                });
            } catch (Exception error) {
                String message = enrollmentErrorMessage(error);
                runOnUiThread(() -> {
                    if (message.startsWith("Code incorrect") || error instanceof EnrollmentStorageWriteException) {
                        // Never leave an expired/consumed code in the field:
                        // the operator must enter a freshly issued code.
                        clearCode();
                    }
                    enrollmentInFlight = false;
                    updateActivateButton();
                    activateButton.setText(R.string.activate);
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private String enrollmentErrorMessage(Exception error) {
        if (error instanceof UnknownHostException) return "Connexion Internet ou DNS indisponible.";
        if (error instanceof SocketTimeoutException) return "Le serveur d’appairage ne répond pas à temps.";
        if (error instanceof EnrollmentStorageWriteException) {
            return "Le serveur a accepté l’activation, mais le token n’a pas pu être conservé sur cette tablette. Le code est désormais consommé : installez la mise à jour, ouvrez Diagnostics, puis générez un nouveau code.";
        }

        String code = error.getMessage() == null ? "UNKNOWN_ERROR" : error.getMessage().trim();
        if (code.startsWith("STORAGE_PREFLIGHT_")) {
            return "Le stockage sécurisé de la tablette n’est pas prêt. Ouvrez Diagnostics avant d’utiliser un code d’activation.";
        }
        switch (code) {
            case "PAIRING_CODE_INVALID_OR_EXPIRED":
                // The server intentionally avoids an oracle that reveals
                // whether a code was used, revoked or merely mistyped.
                return "Code incorrect, expiré, déjà utilisé ou révoqué.";
            case "TOO_MANY_ENROLLMENT_ATTEMPTS":
                return "Trop de tentatives. Attendez avant de réessayer.";
            case "DEVICE_BOUND_TO_ANOTHER_STATION":
                return "Cette tablette est déjà liée à une autre borne. Révoquez-la dans le back-office.";
            case "PAIRING_CONFIGURATION_INVALID":
                return "Configuration de la borne incomplète côté serveur.";
            case "ENROLLMENT_UNAVAILABLE":
                return "Service d’appairage temporairement indisponible.";
            case "KIOSK_ORIGIN_MISMATCH":
                return "Le serveur a renvoyé une mauvaise adresse kiosk.";
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

    private void onKeypadKey(String key) {
        if ("Effacer".equals(key)) {
            clearCode();
        } else if ("⌫".equals(key)) {
            if (activationCode.length() > 0) activationCode.deleteCharAt(activationCode.length() - 1);
            updateCodeDisplay();
        } else if (activationCode.length() < 6 && key.length() == 1 && Character.isDigit(key.charAt(0))) {
            activationCode.append(key);
            updateCodeDisplay();
        }
    }

    private void clearCode() {
        activationCode.setLength(0);
        updateCodeDisplay();
    }

    private void updateCodeDisplay() {
        for (int index = 0; index < 6; index += 1) {
            boolean filled = index < activationCode.length();
            pairingCodeCells[index].setText(filled ? String.valueOf(activationCode.charAt(index)) : "");
            pairingCodeCells[index].setBackground(KioskVisuals.codeCell(filled, dp(14)));
        }
        updateActivateButton();
    }

    private void updateActivateButton() {
        if (activateButton != null) {
            // Keep the action reachable once six digits are present. When the
            // AndroidKeyStore preflight is not ready, provision() gives an
            // immediate visible reason and retries the preflight; it never
            // sends the one-time code before secure storage is proven.
            activateButton.setEnabled(isActivationButtonEnabled(activationCode.length(), enrollmentInFlight));
        }
    }

    static boolean isActivationButtonEnabled(int codeLength, boolean enrollmentInFlight) {
        return codeLength == 6 && !enrollmentInFlight;
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
    protected void onResume() {
        super.onResume();
        KioskVisuals.applyKioskWindow(this);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private static final class EnrollmentStorageWriteException extends Exception {
        EnrollmentStorageWriteException(String code) {
            super(code == null || code.trim().isEmpty() ? "SECURE_STORAGE_UNAVAILABLE" : code);
        }
    }
}
