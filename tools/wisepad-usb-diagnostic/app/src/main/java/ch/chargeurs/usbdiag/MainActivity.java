package ch.chargeurs.usbdiag;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

@SuppressLint("SetTextI18n")
public final class MainActivity extends Activity {
    private final Set<String> baselineDeviceKeys = new HashSet<>();
    private TextView output;
    private TextView baselineStatus;
    private String lastReport = "";
    private boolean baselineCaptured;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildView());
        renderScan();
    }

    private ScrollView buildView() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(7, 15, 32));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(28), dp(22), dp(28), dp(22));
        scroll.addView(content, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView title = text("Chargeurs.ch — WisePad 3 USB Diagnostic", 25, Color.WHITE);
        title.setGravity(Gravity.CENTER_HORIZONTAL);
        content.addView(title, matchWrap(0, dp(6)));

        TextView safety = text(
            "Lecture seule. Cette application n'ouvre aucun périphérique USB, n'envoie aucune commande, ne lance aucun paiement et ne modifie pas la borne.",
            14,
            Color.rgb(190, 203, 226)
        );
        safety.setGravity(Gravity.CENTER_HORIZONTAL);
        content.addView(safety, matchWrap(0, dp(14)));

        baselineStatus = text("Baseline USB : non capturée", 14, Color.rgb(245, 193, 77));
        content.addView(baselineStatus, matchWrap(0, dp(10)));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);

        Button baseline = button("1. Capturer sans WisePad");
        baseline.setOnClickListener(view -> captureBaseline());
        actions.addView(baseline, weightedButton(1f));

        Button scan = button("2. Scanner avec WisePad");
        scan.setOnClickListener(view -> renderScan());
        LinearLayout.LayoutParams scanParams = weightedButton(1f);
        scanParams.setMargins(dp(10), 0, 0, 0);
        actions.addView(scan, scanParams);

        Button copy = button("Copier rapport");
        copy.setOnClickListener(view -> copyReport());
        LinearLayout.LayoutParams copyParams = weightedButton(1f);
        copyParams.setMargins(dp(10), 0, 0, 0);
        actions.addView(copy, copyParams);

        content.addView(actions, matchWrap(0, dp(14)));

        output = text("", 12, Color.WHITE);
        output.setTextIsSelectable(true);
        output.setBackgroundColor(Color.rgb(18, 32, 60));
        output.setPadding(dp(16), dp(16), dp(16), dp(16));
        content.addView(output, matchWrap(0, 0));

        return scroll;
    }

    private void captureBaseline() {
        baselineDeviceKeys.clear();
        UsbManager manager = (UsbManager) getSystemService(Context.USB_SERVICE);
        if (manager != null) {
            for (UsbDevice device : manager.getDeviceList().values()) {
                baselineDeviceKeys.add(deviceKey(device));
            }
        }
        baselineCaptured = true;
        baselineStatus.setText("Baseline USB capturée : " + baselineDeviceKeys.size() + " périphérique(s)");
        baselineStatus.setTextColor(Color.rgb(112, 219, 161));
        renderScan();
    }

    private void renderScan() {
        try {
            JSONObject report = new JSONObject();
            report.put("safeReadOnly", true);
            report.put("baselineCaptured", baselineCaptured);
            report.put("android", androidInfo());
            report.put("usbHostFeature", getPackageManager().hasSystemFeature(PackageManager.FEATURE_USB_HOST));
            report.put("usbDevices", usbDevices());
            report.put("instructions", baselineCaptured
                ? "Brancher/allumer le WisePad 3 puis relancer le scan; chercher newSinceBaseline=true."
                : "Débrancher le WisePad 3, capturer la baseline, puis le rebrancher et relancer le scan.");
            lastReport = report.toString(2);
        } catch (Exception error) {
            lastReport = "{\"safeReadOnly\":true,\"diagnosticError\":\"" + error.getClass().getSimpleName() + "\"}";
        }
        output.setText(lastReport);
    }

    private JSONObject androidInfo() throws Exception {
        JSONObject android = new JSONObject();
        android.put("manufacturer", Build.MANUFACTURER);
        android.put("brand", Build.BRAND);
        android.put("model", Build.MODEL);
        android.put("device", Build.DEVICE);
        android.put("product", Build.PRODUCT);
        android.put("hardware", Build.HARDWARE);
        android.put("board", Build.BOARD);
        android.put("sdk", Build.VERSION.SDK_INT);
        android.put("release", Build.VERSION.RELEASE);
        return android;
    }

    private JSONArray usbDevices() throws Exception {
        JSONArray devices = new JSONArray();
        UsbManager manager = (UsbManager) getSystemService(Context.USB_SERVICE);
        if (manager == null) return devices;

        for (Map.Entry<String, UsbDevice> entry : manager.getDeviceList().entrySet()) {
            UsbDevice device = entry.getValue();
            JSONObject item = new JSONObject();
            item.put("deviceName", entry.getKey());
            item.put("vendorId", device.getVendorId());
            item.put("productId", device.getProductId());
            item.put("deviceClass", device.getDeviceClass());
            item.put("deviceSubclass", device.getDeviceSubclass());
            item.put("deviceProtocol", device.getDeviceProtocol());
            item.put("interfaceCount", device.getInterfaceCount());
            item.put("androidPermissionAlreadyGranted", manager.hasPermission(device));
            item.put("newSinceBaseline", baselineCaptured && !baselineDeviceKeys.contains(deviceKey(device)));

            JSONArray interfaces = new JSONArray();
            for (int index = 0; index < device.getInterfaceCount(); index += 1) {
                UsbInterface usbInterface = device.getInterface(index);
                JSONObject iface = new JSONObject();
                iface.put("index", index);
                iface.put("id", usbInterface.getId());
                iface.put("class", usbInterface.getInterfaceClass());
                iface.put("subclass", usbInterface.getInterfaceSubclass());
                iface.put("protocol", usbInterface.getInterfaceProtocol());
                iface.put("endpointCount", usbInterface.getEndpointCount());
                interfaces.put(iface);
            }
            item.put("interfaces", interfaces);
            devices.put(item);
        }
        return devices;
    }

    private String deviceKey(UsbDevice device) {
        return device.getVendorId() + ":" + device.getProductId() + ":" + device.getDeviceName();
    }

    private void copyReport() {
        if (lastReport.isEmpty()) return;
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) return;
        clipboard.setPrimaryClip(ClipData.newPlainText("Chargeurs WisePad USB diagnostic", lastReport));
        Toast.makeText(this, "Rapport USB copié", Toast.LENGTH_LONG).show();
    }

    private TextView text(String value, int sizeSp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        return view;
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setMinHeight(dp(54));
        return button;
    }

    private LinearLayout.LayoutParams weightedButton(float weight) {
        return new LinearLayout.LayoutParams(0, dp(58), weight);
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
