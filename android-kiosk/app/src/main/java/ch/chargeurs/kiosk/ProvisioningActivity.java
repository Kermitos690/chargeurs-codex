package ch.chargeurs.kiosk;

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

public final class ProvisioningActivity extends Activity {
    private EditText stationInput;
    private EditText tokenInput;
    private EditText baseUrlInput;
    private SecureConfigStore store;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new SecureConfigStore(this);
        if (store.load() != null) {
            launchKiosk();
            return;
        }
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

        stationInput = field(getString(R.string.station_id));
        stationInput.setSingleLine(true);
        stationInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        content.addView(stationInput, matchWrap(0, dp(12)));

        tokenInput = field(getString(R.string.kiosk_token));
        tokenInput.setSingleLine(true);
        tokenInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        content.addView(tokenInput, matchWrap(0, dp(12)));

        baseUrlInput = field(getString(R.string.base_url));
        baseUrlInput.setSingleLine(true);
        baseUrlInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        baseUrlInput.setText("https://chargeurs.ch");
        content.addView(baseUrlInput, matchWrap(0, dp(24)));

        Button activate = new Button(this);
        activate.setText(R.string.activate);
        activate.setTextSize(17);
        activate.setAllCaps(false);
        activate.setOnClickListener(view -> provision());
        content.addView(activate, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(56)
        ));

        TextView warning = text(
            "Après activation, la configuration n’est plus accessible depuis l’écran public. Pour changer de borne, l’opérateur doit effacer les données de l’application ou la reprovisionner avec les outils de gestion du terminal.",
            13,
            Color.rgb(148, 163, 192)
        );
        warning.setGravity(Gravity.CENTER);
        content.addView(warning, matchWrap(0, dp(12)));

        return scroll;
    }

    private void provision() {
        String station = stationInput.getText().toString().trim();
        String token = tokenInput.getText().toString().trim();
        String baseUrl = KioskConfigValidator.normalizeBaseUrl(baseUrlInput.getText().toString());

        if (!KioskConfigValidator.isValidStationId(station)) {
            stationInput.setError(getString(R.string.invalid_station));
            return;
        }
        if (!KioskConfigValidator.isValidToken(token)) {
            tokenInput.setError(getString(R.string.invalid_token));
            return;
        }
        if (baseUrl == null) {
            baseUrlInput.setError(getString(R.string.invalid_url));
            return;
        }

        if (!store.save(new KioskConfig(station, token, baseUrl))) {
            Toast.makeText(this, "Le stockage chiffré a échoué.", Toast.LENGTH_LONG).show();
            return;
        }

        tokenInput.setText("");
        launchKiosk();
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
}
