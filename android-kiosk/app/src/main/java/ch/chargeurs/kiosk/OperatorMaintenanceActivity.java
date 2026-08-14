package ch.chargeurs.kiosk;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.net.SocketTimeoutException;
import java.net.UnknownHostException;

/**
 * Local native maintenance surface. It deliberately exposes no business-admin
 * session: pairing still requires a one-time backend code and the current
 * credential remains in secure storage until a replacement is saved.
 */
@SuppressLint("SetTextI18n")
public final class OperatorMaintenanceActivity extends Activity {
    private static final long SESSION_TIMEOUT_MS = 10 * 60_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final StringBuilder pairingCode = new StringBuilder(6);
    private final TextView[] codeCells = new TextView[6];
    private SecureConfigStore store;
    private Button pairButton;
    private TextView status;
    private boolean pairingInFlight;

    private final Runnable timeout = this::finish;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new SecureConfigStore(this);
        KioskVisuals.applyKioskWindow(this);
        setContentView(buildView());
        armTimeout();
    }

    private FrameLayout buildView() {
        FrameLayout root = new FrameLayout(this);
        root.addView(new KioskAmbientBackground(this), new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(28), dp(24), dp(28), dp(28));
        content.setBackground(KioskVisuals.glassPanel(dp(28)));
        scroll.addView(content, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        FrameLayout.LayoutParams scrollParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        scrollParams.gravity = Gravity.CENTER;
        scrollParams.setMargins(dp(24), dp(20), dp(24), dp(20));
        root.addView(scroll, scrollParams);

        TextView brand = KioskVisuals.brandText(this, 22);
        content.addView(brand, fullWidth(0, dp(10)));

        TextView title = text("Service Console", 30, KioskVisuals.WHITE);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        content.addView(title, fullWidth(0, dp(8)));

        TextView security = text(
            "Session technicien locale · sans publicité · aucun droit de paiement, location ou éjection n’est accordé par le code technicien.",
            14,
            KioskVisuals.MUTED
        );
        content.addView(security, fullWidth(0, dp(18)));

        KioskConfig current = store.load();

        // Pairing is deliberately the first and most prominent maintenance
        // action. There is no manual station picker: station authority remains
        // the one-time backend pairing code and the enrolled KioskConfig.
        TextView pairingTitle = text("Appairage tablette", 22, KioskVisuals.WHITE);
        pairingTitle.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        content.addView(pairingTitle, fullWidth(0, dp(6)));

        TextView pairingHelp = text(
            "Générez dans le back-office le code temporaire à 6 chiffres de la borne à associer, puis saisissez-le ici. La liaison actuelle n’est jamais effacée avant la réussite complète.",
            14,
            KioskVisuals.MUTED
        );
        content.addView(pairingHelp, fullWidth(0, dp(14)));

        LinearLayout cells = new LinearLayout(this);
        cells.setGravity(Gravity.CENTER);
        for (int index = 0; index < 6; index += 1) {
            TextView cell = text("", 26, KioskVisuals.WHITE);
            cell.setGravity(Gravity.CENTER);
            cell.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            LinearLayout.LayoutParams cellParams = new LinearLayout.LayoutParams(0, dp(54), 1f);
            cellParams.setMargins(index == 0 ? 0 : dp(5), 0, 0, 0);
            cells.addView(cell, cellParams);
            codeCells[index] = cell;
        }
        content.addView(cells, fullWidth(0, dp(12)));
        updateCodeDisplay();

        GridLayout keypad = new GridLayout(this);
        keypad.setColumnCount(3);
        for (String key : new String[] { "1", "2", "3", "4", "5", "6", "7", "8", "9", "Effacer", "0", "⌫" }) {
            Button button = new Button(this);
            button.setText(key);
            button.setTextColor(KioskVisuals.WHITE);
            button.setTextSize(key.length() == 1 ? 22 : 13);
            button.setAllCaps(false);
            button.setBackground(KioskVisuals.secondaryButton(dp(16)));
            button.setOnClickListener(view -> {
                armTimeout();
                onKeypadKey(key);
            });
            GridLayout.LayoutParams params = new GridLayout.LayoutParams();
            params.width = 0;
            params.height = dp(55);
            params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
            params.setMargins(dp(4), dp(4), dp(4), dp(4));
            keypad.addView(button, params);
        }
        content.addView(keypad, fullWidth(0, dp(10)));

        status = text("", 13, KioskVisuals.MUTED);
        status.setGravity(Gravity.CENTER);
        content.addView(status, fullWidth(0, dp(10)));

        pairButton = new Button(this);
        pairButton.setText("Associer cette tablette");
        pairButton.setTextColor(KioskVisuals.WHITE);
        pairButton.setTextSize(16);
        pairButton.setAllCaps(false);
        pairButton.setBackground(KioskVisuals.primaryButton(dp(24)));
        pairButton.setEnabled(false);
        pairButton.setOnClickListener(view -> {
            armTimeout();
            pair();
        });
        content.addView(pairButton, fixedButton(dp(58), 0, dp(22)));

        content.addView(sectionCard(
            "Identité de la borne",
            current == null
                ? "Station : non appairée\nAppareil : " + DeviceIdentity.getOrCreate(this)
                : "Station : " + current.stationId()
                    + "\nAppareil : " + DeviceIdentity.getOrCreate(this)
        ), fullWidth(0, dp(10)));

        content.addView(sectionCard(
            "Réseau / serveurs",
            networkSummary(current)
        ), fullWidth(0, dp(10)));

        SecureConfigStore.StorageHealth storageHealth = store.inspect();
        content.addView(sectionCard(
            "État de l’APK Chargeurs.ch",
            "Package : " + getPackageName()
                + "\nVersion : " + BuildConfig.VERSION_NAME
                + "\nStockage sécurisé : " + storageHealth.code()
                + "\nJeton affiché : non"
        ), fullWidth(0, dp(10)));

        content.addView(sectionCard(
            "Fournisseur Bajie",
            vendorSummary()
        ), fullWidth(0, dp(18)));

        Button diagnostics = new Button(this);
        diagnostics.setText("Diagnostic complet matériel / terminal");
        diagnostics.setTextColor(KioskVisuals.WHITE);
        diagnostics.setAllCaps(false);
        diagnostics.setBackground(KioskVisuals.secondaryButton(dp(24)));
        diagnostics.setOnClickListener(view -> {
            armTimeout();
            startActivity(new Intent(this, HardwareDiagnosticActivity.class));
        });
        content.addView(diagnostics, fixedButton(dp(54), 0, dp(10)));

        Button restart = new Button(this);
        restart.setText("Redémarrer le kiosque");
        restart.setTextColor(KioskVisuals.WHITE);
        restart.setAllCaps(false);
        restart.setBackground(KioskVisuals.secondaryButton(dp(24)));
        restart.setOnClickListener(view -> restartKiosk());
        content.addView(restart, fixedButton(dp(54), 0, dp(10)));

        Button close = new Button(this);
        close.setText("Quitter le mode service");
        close.setTextColor(KioskVisuals.WHITE);
        close.setAllCaps(false);
        close.setBackground(KioskVisuals.secondaryButton(dp(24)));
        close.setOnClickListener(view -> finish());
        content.addView(close, fixedButton(dp(54), 0, 0));

        KioskVisuals.fadeIn(content);
        return root;
    }

    private TextView sectionCard(String title, String body) {
        TextView card = text(title + "\n" + body, 14, KioskVisuals.WHITE);
        card.setLineSpacing(dp(3), 1f);
        card.setPadding(dp(16), dp(14), dp(16), dp(14));
        card.setBackground(KioskVisuals.secondaryButton(dp(18)));
        return card;
    }

    private String networkSummary(KioskConfig current) {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        boolean internet = false;
        String transport = "indéterminé";
        if (manager != null) {
            Network active = manager.getActiveNetwork();
            NetworkCapabilities capabilities = active == null ? null : manager.getNetworkCapabilities(active);
            if (capabilities != null) {
                internet = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transport = "Wi-Fi";
                else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transport = "Ethernet";
                else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transport = "cellulaire";
                else transport = "autre";
            }
        }
        String server = current == null ? BuildConfig.KIOSK_PUBLIC_BASE_URL : current.baseUrl();
        return "Internet : " + (internet ? "disponible" : "indisponible")
            + "\nTransport : " + transport
            + "\nServeur kiosque configuré : " + server;
    }

    private String vendorSummary() {
        JSONObject vendor = VendorAppCompatibility.inspect(this);
        String version = vendor.optString("versionName", "");
        return "Package : " + VendorAppCompatibility.VENDOR_PACKAGE
            + "\nInstallée : " + (vendor.optBoolean("installed", false) ? "oui" : "non")
            + (version.isEmpty() ? "" : "\nVersion : " + version)
            + "\nÉtat : " + vendor.optString("state", "inconnu")
            + "\nBridge public : " + vendor.optString("publicBridgeStatus", "inconnu")
            + "\nContrôle fournisseur : aucune action invasive depuis cette console";
    }

    private void restartKiosk() {
        armTimeout();
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(intent);
        finish();
    }

    private void pair() {
        if (pairingInFlight || !EnrollmentClient.isValidPairingCode(pairingCode.toString())) return;
        final String candidate = pairingCode.toString();
        pairingInFlight = true;
        updatePairButton();
        status.setText("Vérification et appairage sécurisé…");
        status.setTextColor(KioskVisuals.MUTED);

        new Thread(() -> {
            try {
                SecureConfigStore.StorageHealth health = store.prepareForEnrollment();
                if (!health.isReady()) throw new IllegalStateException("STORAGE_PREFLIGHT_" + health.code());

                EnrollmentResult result = EnrollmentClient.enroll(
                    BuildConfig.ENROLLMENT_URL,
                    candidate,
                    DeviceIdentity.getOrCreate(this),
                    BuildConfig.VERSION_NAME
                );
                if (!KioskConfigValidator.matchesPinnedBaseUrl(
                    result.config().baseUrl(),
                    BuildConfig.KIOSK_PUBLIC_BASE_URL
                )) throw new IllegalStateException("KIOSK_ORIGIN_MISMATCH");

                SecureConfigStore.SaveResult saved = store.save(result.config());
                if (!saved.isSaved()) throw new IllegalStateException("STORAGE_SAVE_" + saved.code());

                new LocalAuditLog(this).record("kiosk.operator.reenrollment.saved", JsonObjects.of(
                    "stationId", result.config().stationId(),
                    "deviceId", DeviceIdentity.getOrCreate(this)
                ));

                runOnUiThread(() -> {
                    clearCode();
                    Intent intent = new Intent(this, MainActivity.class);
                    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                    finish();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    pairingInFlight = false;
                    clearCode();
                    status.setText(pairingErrorMessage(error));
                    status.setTextColor(KioskVisuals.WARNING);
                    updatePairButton();
                });
            }
        }, "chargeurs-operator-pairing").start();
    }

    private String pairingErrorMessage(Exception error) {
        if (error instanceof UnknownHostException) return "Connexion Internet ou DNS indisponible.";
        if (error instanceof SocketTimeoutException) return "Le serveur d’appairage ne répond pas à temps.";
        String code = error.getMessage() == null ? "UNKNOWN_ERROR" : error.getMessage().trim();
        if (code.startsWith("STORAGE_PREFLIGHT_") || code.startsWith("STORAGE_SAVE_")) {
            return "Stockage sécurisé indisponible. Ouvrez Diagnostic avant de générer un nouveau code.";
        }
        switch (code) {
            case "PAIRING_CODE_INVALID_OR_EXPIRED":
            case "PAIRING_CODE_ALREADY_USED":
                return "Code incorrect, expiré, déjà utilisé ou révoqué.";
            case "TOO_MANY_ENROLLMENT_ATTEMPTS":
                return "Trop de tentatives. Attendez avant de réessayer.";
            case "DEVICE_BOUND_TO_ANOTHER_STATION":
                return "Cette tablette est enregistrée sur une autre borne. Révoquez d’abord cette liaison dans le back-office, puis générez un nouveau code.";
            case "KIOSK_ORIGIN_MISMATCH":
                return "Le serveur a renvoyé une adresse kiosque non autorisée.";
            default:
                return "Appairage impossible. Vérifiez le code temporaire et la connexion.";
        }
    }

    private void onKeypadKey(String key) {
        if (pairingInFlight) return;
        if ("Effacer".equals(key)) pairingCode.setLength(0);
        else if ("⌫".equals(key)) {
            if (pairingCode.length() > 0) pairingCode.deleteCharAt(pairingCode.length() - 1);
        } else if (pairingCode.length() < 6) pairingCode.append(key);
        status.setText("");
        updateCodeDisplay();
    }

    private void clearCode() {
        pairingCode.setLength(0);
        updateCodeDisplay();
    }

    private void updateCodeDisplay() {
        for (int index = 0; index < codeCells.length; index += 1) {
            if (codeCells[index] == null) continue;
            boolean filled = index < pairingCode.length();
            codeCells[index].setText(filled ? String.valueOf(pairingCode.charAt(index)) : "");
            codeCells[index].setBackground(KioskVisuals.codeCell(filled, dp(13)));
        }
        updatePairButton();
    }

    private void updatePairButton() {
        if (pairButton != null) pairButton.setEnabled(pairingCode.length() == 6 && !pairingInFlight);
    }

    private void armTimeout() {
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, SESSION_TIMEOUT_MS);
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private LinearLayout.LayoutParams fullWidth(int top, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, top, 0, bottom);
        return params;
    }

    private LinearLayout.LayoutParams fixedButton(int height, int top, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            height
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
        armTimeout();
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(timeout);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
