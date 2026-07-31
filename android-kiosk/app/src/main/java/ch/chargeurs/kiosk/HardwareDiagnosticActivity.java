package ch.chargeurs.kiosk;

import android.annotation.SuppressLint;
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

@SuppressLint("SetTextI18n")
public final class HardwareDiagnosticActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private TextView output;
    private Button copyButton;
    private String report = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
        title.setText("Diagnostic matériel automatique DTA");
        title.setTextSize(25);
        title.setTextColor(Color.WHITE);
        title.setGravity(Gravity.CENTER);
        content.addView(title, matchWrap(dp(8), dp(12)));

        TextView help = new TextView(this);
        help.setText("Lecture uniquement : ports série, USB, pilotes, firmware Android et présence de l’APK fournisseur. Aucune commande n’est envoyée à la borne.");
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
        closeButton.setText("Retour à l’activation");
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
        executor.execute(() -> {
            String formatted;
            try {
                JSONObject collected = HardwareDiagnosticCollector.collect(this);
                formatted = collected.toString(2);
            } catch (Exception error) {
                formatted = "{\n  \"diagnosticError\": \"" + error.getClass().getSimpleName() + "\",\n  \"safeReadOnly\": true\n}";
            }
            final String result = formatted;
            runOnUiThread(() -> {
                report = result;
                output.setText(result);
                copyButton.setEnabled(true);
            });
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
