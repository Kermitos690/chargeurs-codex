package ch.chargeurs.kiosk;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.lang.ref.WeakReference;

/**
 * Native operator entry point intentionally placed above the WebView or locked
 * activation surface. It stays reachable when Ads, kiosk auth or network is
 * degraded. The fixed PIN is checked only against a native derived verifier;
 * it grants no backend credential.
 */
@SuppressLint("SetTextI18n")
final class OperatorAccessGate {
    private static final String HOTSPOT_TAG = "chargeurs.operator.hotspot.v1";
    private static WeakReference<AlertDialog> dialogRef = new WeakReference<>(null);

    private OperatorAccessGate() {}

    static void install(Activity activity) {
        activity.runOnUiThread(() -> {
            View decor = activity.getWindow().getDecorView();
            if (decor.findViewWithTag(HOTSPOT_TAG) != null) return;

            OperatorTapSequence sequence = new OperatorTapSequence();
            View hotspot = new View(activity);
            hotspot.setTag(HOTSPOT_TAG);
            hotspot.setBackgroundColor(Color.TRANSPARENT);
            hotspot.setClickable(true);
            hotspot.setFocusable(false);
            hotspot.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            hotspot.setOnClickListener(view -> {
                if (sequence.record(SystemClock.elapsedRealtime())) open(activity);
            });
            hotspot.setElevation(dp(activity, 100));

            android.widget.FrameLayout.LayoutParams params = new android.widget.FrameLayout.LayoutParams(
                dp(activity, 92),
                dp(activity, 92)
            );
            params.gravity = Gravity.TOP | Gravity.START;
            activity.addContentView(hotspot, params);
        });
    }

    static void open(Activity activity) {
        activity.runOnUiThread(() -> {
            if (activity.isFinishing()) return;
            AlertDialog existing = dialogRef.get();
            if (existing != null && existing.isShowing()) return;
            showPinDialog(activity);
        });
    }

    private static void showPinDialog(Activity activity) {
        int gap = dp(activity, 10);
        StringBuilder pin = new StringBuilder(6);

        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(activity, 24), dp(activity, 22), dp(activity, 24), dp(activity, 22));
        content.setBackground(KioskVisuals.glassPanel(dp(activity, 24)));

        TextView brand = KioskVisuals.brandText(activity, 20);
        content.addView(brand, fullWidth(0, gap));

        TextView title = text(activity, "Accès opérateur", 26, KioskVisuals.WHITE);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        content.addView(title, fullWidth(0, gap));

        TextView help = text(
            activity,
            "Saisissez le code de maintenance. Cet accès ouvre uniquement les outils locaux de la borne et reste disponible hors ligne.",
            14,
            KioskVisuals.MUTED
        );
        content.addView(help, fullWidth(0, dp(activity, 16)));

        TextView code = text(activity, "○  ○  ○  ○  ○  ○", 28, KioskVisuals.WHITE);
        code.setGravity(Gravity.CENTER);
        content.addView(code, fullWidth(0, dp(activity, 14)));

        TextView status = text(activity, "", 13, KioskVisuals.MUTED);
        status.setGravity(Gravity.CENTER);
        content.addView(status, fullWidth(0, gap));

        GridLayout keypad = new GridLayout(activity);
        keypad.setColumnCount(3);
        String[] keys = { "1", "2", "3", "4", "5", "6", "7", "8", "9", "Effacer", "0", "⌫" };
        final Button[] verifyHolder = new Button[1];
        for (String key : keys) {
            Button button = new Button(activity);
            button.setText(key);
            button.setTextColor(KioskVisuals.WHITE);
            button.setTextSize(key.length() == 1 ? 22 : 13);
            button.setAllCaps(false);
            button.setBackground(KioskVisuals.secondaryButton(dp(activity, 16)));
            button.setOnClickListener(view -> {
                if ("Effacer".equals(key)) pin.setLength(0);
                else if ("⌫".equals(key)) {
                    if (pin.length() > 0) pin.deleteCharAt(pin.length() - 1);
                } else if (pin.length() < 6) pin.append(key);
                updatePinDisplay(code, pin.length());
                if (verifyHolder[0] != null) verifyHolder[0].setEnabled(pin.length() == 6);
                status.setText("");
            });
            GridLayout.LayoutParams params = new GridLayout.LayoutParams();
            params.width = 0;
            params.height = dp(activity, 56);
            params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
            params.setMargins(dp(activity, 4), dp(activity, 4), dp(activity, 4), dp(activity, 4));
            keypad.addView(button, params);
        }
        content.addView(keypad, fullWidth(0, dp(activity, 16)));

        LinearLayout actions = new LinearLayout(activity);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);

        Button cancel = new Button(activity);
        cancel.setText("Annuler");
        cancel.setAllCaps(false);
        cancel.setTextColor(KioskVisuals.WHITE);
        cancel.setBackground(KioskVisuals.secondaryButton(dp(activity, 22)));
        actions.addView(cancel, weightedButton(activity, 1f, 0, dp(activity, 5)));

        Button verify = new Button(activity);
        verify.setText("Vérifier");
        verify.setAllCaps(false);
        verify.setTextColor(KioskVisuals.WHITE);
        verify.setBackground(KioskVisuals.primaryButton(dp(activity, 22)));
        verify.setEnabled(false);
        verifyHolder[0] = verify;
        actions.addView(verify, weightedButton(activity, 1f, dp(activity, 5), 0));
        content.addView(actions, fullWidth(0, 0));

        AlertDialog dialog = new AlertDialog.Builder(activity)
            .setView(content)
            .setCancelable(true)
            .create();
        dialogRef = new WeakReference<>(dialog);
        dialog.setOnDismissListener(ignored -> {
            pin.setLength(0);
            AlertDialog current = dialogRef.get();
            if (current == dialog) dialogRef.clear();
        });
        cancel.setOnClickListener(view -> dialog.dismiss());
        verify.setOnClickListener(view -> {
            if (pin.length() != 6) return;
            final String candidate = pin.toString();
            pin.setLength(0);
            verify.setEnabled(false);
            cancel.setEnabled(false);
            status.setText("Vérification locale…");
            status.setTextColor(KioskVisuals.MUTED);
            new Thread(() -> {
                OperatorPinVerifier.Result result = OperatorPinVerifier.verify(activity, candidate);
                activity.runOnUiThread(() -> {
                    if (activity.isFinishing() || !dialog.isShowing()) return;
                    if (result == OperatorPinVerifier.Result.ACCEPTED) {
                        dialog.dismiss();
                        activity.startActivity(new Intent(activity, OperatorMaintenanceActivity.class));
                        return;
                    }
                    updatePinDisplay(code, 0);
                    verify.setEnabled(false);
                    cancel.setEnabled(true);
                    if (result == OperatorPinVerifier.Result.LOCKED) {
                        long seconds = Math.max(1L, (OperatorPinVerifier.remainingLockoutMs(activity) + 999L) / 1000L);
                        status.setText("Accès temporairement verrouillé après plusieurs essais (" + seconds + " s).");
                    } else {
                        status.setText("Code opérateur incorrect.");
                    }
                    status.setTextColor(KioskVisuals.WARNING);
                });
            }, "chargeurs-operator-pin").start();
        });

        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setDimAmount(.72f);
            dialog.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            dialog.getWindow().setLayout(
                Math.min(dp(activity, 560), activity.getResources().getDisplayMetrics().widthPixels - dp(activity, 32)),
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
        }
    }

    private static void updatePinDisplay(TextView view, int length) {
        StringBuilder display = new StringBuilder();
        for (int index = 0; index < 6; index += 1) {
            if (index > 0) display.append("  ");
            display.append(index < length ? "●" : "○");
        }
        view.setText(display.toString());
    }

    private static TextView text(Activity activity, String value, int size, int color) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private static LinearLayout.LayoutParams fullWidth(int top, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, top, 0, bottom);
        return params;
    }

    private static LinearLayout.LayoutParams weightedButton(Activity activity, float weight, int left, int right) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(activity, 56), weight);
        params.setMargins(left, 0, right, 0);
        return params;
    }

    private static int dp(Activity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
