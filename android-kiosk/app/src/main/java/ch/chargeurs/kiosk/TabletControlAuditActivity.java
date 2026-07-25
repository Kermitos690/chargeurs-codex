package ch.chargeurs.kiosk;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.UserManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class TabletControlAuditActivity extends Activity {
    private static final String STATION_ID = "DTA21269";
    private static final String VENDOR_PACKAGE = "com.szbjkj.bajietouchpower";
    private static final int MAX_OUTPUT_BYTES = 64 * 1024;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private TextView summary;
    private TextView details;
    private Button runButton;
    private Button exportButton;
    private JSONObject latestReport;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildView());
        runAudit();
    }

    private ScrollView buildView() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(8, 17, 38));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(28), dp(30), dp(28), dp(28));
        scroll.addView(content, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView title = text("Inspection tablette Chargeurs.ch", 28, Color.WHITE);
        title.setGravity(Gravity.CENTER);
        content.addView(title, matchWrap(0, dp(8)));

        TextView subtitle = text(
            "Borne " + STATION_ID + " — contrôle de Google Play, du root, du mode kiosque et des mises à jour. "
                + "Aucune application n’est supprimée et aucun réglage n’est modifié.",
            15,
            Color.rgb(190, 202, 226)
        );
        subtitle.setGravity(Gravity.CENTER);
        content.addView(subtitle, matchWrap(0, dp(16)));

        summary = text("Analyse en cours…", 16, Color.rgb(119, 255, 184));
        summary.setPadding(dp(16), dp(16), dp(16), dp(16));
        summary.setBackgroundColor(Color.rgb(19, 34, 66));
        content.addView(summary, matchWrap(0, dp(14)));

        runButton = actionButton("Relancer l’inspection", this::runAudit);
        content.addView(runButton, fullButton());

        Button installSettings = actionButton(
            "Ouvrir l’autorisation d’installation APK",
            this::openUnknownSourcesSettings
        );
        LinearLayout.LayoutParams installParams = fullButton();
        installParams.setMargins(0, dp(10), 0, 0);
        content.addView(installSettings, installParams);

        Button vendorButton = actionButton("Ouvrir l’application fournisseur", this::openVendorApp);
        LinearLayout.LayoutParams vendorParams = fullButton();
        vendorParams.setMargins(0, dp(10), 0, 0);
        content.addView(vendorButton, vendorParams);

        exportButton = actionButton("Exporter et envoyer le rapport", this::exportReport);
        exportButton.setEnabled(false);
        LinearLayout.LayoutParams exportParams = fullButton();
        exportParams.setMargins(0, dp(10), 0, 0);
        content.addView(exportButton, exportParams);

        details = text("", 12, Color.WHITE);
        details.setTextIsSelectable(true);
        details.setPadding(dp(14), dp(14), dp(14), dp(14));
        details.setBackgroundColor(Color.rgb(19, 34, 66));
        content.addView(details, matchWrap(dp(16), 0));
        return scroll;
    }

    private void runAudit() {
        runButton.setEnabled(false);
        exportButton.setEnabled(false);
        summary.setText("Inspection en cours…");
        details.setText("");
        latestReport = null;

        executor.execute(() -> {
            try {
                JSONObject report = collectAudit();
                String human = buildSummary(report);
                String formatted = report.toString(2);
                runOnUiThread(() -> {
                    latestReport = report;
                    summary.setText(human);
                    details.setText(formatted);
                    runButton.setEnabled(true);
                    exportButton.setEnabled(true);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    summary.setText("Échec de l’inspection : " + error.getClass().getSimpleName());
                    runButton.setEnabled(true);
                    Toast.makeText(this, "Impossible de terminer l’inspection.", Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    @SuppressLint("QueryPermissionsNeeded")
    @SuppressWarnings("deprecation")
    private JSONObject collectAudit() throws Exception {
        PackageManager pm = getPackageManager();
        DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
        UserManager userManager = (UserManager) getSystemService(Context.USER_SERVICE);

        JSONObject report = new JSONObject();
        report.put("schemaVersion", 2);
        report.put("generatedAt", System.currentTimeMillis());
        report.put("stationId", STATION_ID);
        report.put("appVersion", BuildConfig.VERSION_NAME);
        report.put("safeReadOnly", true);
        report.put("settingsChanged", false);
        report.put("packageInstallAttempted", false);

        JSONObject device = new JSONObject();
        device.put("manufacturer", Build.MANUFACTURER);
        device.put("brand", Build.BRAND);
        device.put("model", Build.MODEL);
        device.put("product", Build.PRODUCT);
        device.put("hardware", Build.HARDWARE);
        device.put("board", Build.BOARD);
        device.put("androidRelease", Build.VERSION.RELEASE);
        device.put("sdk", Build.VERSION.SDK_INT);
        device.put("fingerprint", Build.FINGERPRINT);
        device.put("adbEnabled", globalSetting(Settings.Global.ADB_ENABLED));
        device.put("developerOptionsEnabled", globalSetting(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED));
        device.put("usbConfig", command("getprop sys.usb.config"));
        report.put("device", device);

        JSONObject google = new JSONObject();
        google.put("playServices", packageSummary(pm, "com.google.android.gms"));
        google.put("playStore", packageSummary(pm, "com.android.vending"));
        google.put("servicesFramework", packageSummary(pm, "com.google.android.gsf"));
        report.put("google", google);

        report.put("vendorApplication", packageSummary(pm, VENDOR_PACKAGE));
        report.put("chargeursInspector", packageSummary(pm, getPackageName()));

        JSONObject policy = new JSONObject();
        String ownerPackage = findDeviceOwnerPackage(dpm, pm);
        policy.put("deviceOwnerPackage", ownerPackage);
        policy.put("deviceOwnerLabel", ownerPackage.isEmpty() ? "" : packageLabel(pm, ownerPackage));
        policy.put("selfIsDeviceOwner", dpm != null && dpm.isDeviceOwnerApp(getPackageName()));
        policy.put("selfIsProfileOwner", dpm != null && dpm.isProfileOwnerApp(getPackageName()));
        policy.put("selfLockTaskPermitted", dpm != null && dpm.isLockTaskPermitted(getPackageName()));
        policy.put("vendorLockTaskPermitted", dpm != null && dpm.isLockTaskPermitted(VENDOR_PACKAGE));
        policy.put("activeAdmins", activeAdmins(dpm));
        policy.put("dumpsysDevicePolicy", command("dumpsys device_policy"));
        report.put("devicePolicy", policy);

        JSONObject restrictions = new JSONObject();
        if (userManager != null) {
            Bundle values = userManager.getUserRestrictions();
            for (String key : values.keySet()) restrictions.put(key, values.get(key));
        }
        report.put("userRestrictions", restrictions);

        JSONObject root = rootAudit();
        report.put("root", root);

        boolean unknownSources = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || pm.canRequestPackageInstalls();
        boolean installPermission = checkSelfPermission("android.permission.INSTALL_PACKAGES")
            == PackageManager.PERMISSION_GRANTED;
        boolean selfSystemApp = (getApplicationInfo().flags & ApplicationInfo.FLAG_SYSTEM) != 0;
        boolean selfDeviceOwner = dpm != null && dpm.isDeviceOwnerApp(getPackageName());
        boolean rootUsable = root.optBoolean("usable", false);

        JSONObject installation = new JSONObject();
        installation.put("canRequestUnknownSourceInstalls", unknownSources);
        installation.put("holdsInstallPackagesPermission", installPermission);
        installation.put("selfIsSystemApp", selfSystemApp);
        installation.put("selfIsDeviceOwner", selfDeviceOwner);
        installation.put("rootUsable", rootUsable);
        installation.put("silentUpdateTechnicallyPossible", rootUsable || installPermission || selfDeviceOwner);
        installation.put(
            "silentUpdateReason",
            rootUsable ? "root_available"
                : installPermission ? "install_packages_permission"
                : selfDeviceOwner ? "device_owner"
                : "manual_confirmation_required"
        );
        installation.put("packageInstaller", resolvePackageInstaller(pm));
        report.put("installation", installation);

        JSONObject startup = new JSONObject();
        startup.put("defaultHome", resolveDefaultHome(pm));
        startup.put("technicalBootReceivers", technicalBootReceivers(pm));
        report.put("startup", startup);

        report.put("technicalPackages", technicalPackages(pm));
        report.put("networkAndSerialSnapshot", HardwareDiagnosticCollector.collect(this));
        return report;
    }

    private int globalSetting(String key) {
        try {
            return Settings.Global.getInt(getContentResolver(), key, 0);
        } catch (RuntimeException ignored) {
            return -1;
        }
    }

    @SuppressWarnings("deprecation")
    private JSONObject packageSummary(PackageManager pm, String packageName) {
        JSONObject value = new JSONObject();
        put(value, "package", packageName);
        try {
            PackageInfo info = pm.getPackageInfo(packageName, 0);
            ApplicationInfo app = info.applicationInfo;
            put(value, "installed", true);
            put(value, "enabled", app != null && app.enabled);
            put(value, "label", packageLabel(pm, packageName));
            put(value, "versionName", info.versionName == null ? "" : info.versionName);
            put(value, "versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            put(value, "systemApp", app != null && (app.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
            put(value, "sourceDir", app == null ? "" : app.sourceDir);
            put(value, "installerPackage", installerPackage(pm, packageName));
        } catch (PackageManager.NameNotFoundException error) {
            put(value, "installed", false);
        }
        return value;
    }

    @SuppressLint("QueryPermissionsNeeded")
    @SuppressWarnings("deprecation")
    private String findDeviceOwnerPackage(DevicePolicyManager dpm, PackageManager pm) {
        if (dpm == null) return "";
        try {
            List<PackageInfo> packages = pm.getInstalledPackages(0);
            for (PackageInfo info : packages) {
                if (info != null && info.packageName != null && dpm.isDeviceOwnerApp(info.packageName)) {
                    return info.packageName;
                }
            }
        } catch (RuntimeException ignored) {
            return "";
        }
        return "";
    }

    private JSONArray activeAdmins(DevicePolicyManager dpm) {
        JSONArray result = new JSONArray();
        if (dpm == null) return result;
        try {
            List<ComponentName> admins = dpm.getActiveAdmins();
            if (admins == null) return result;
            for (ComponentName admin : admins) {
                JSONObject item = new JSONObject();
                put(item, "package", admin.getPackageName());
                put(item, "class", admin.getClassName());
                result.put(item);
            }
        } catch (RuntimeException error) {
            JSONObject item = new JSONObject();
            put(item, "error", error.getClass().getSimpleName());
            result.put(item);
        }
        return result;
    }

    @SuppressWarnings("deprecation")
    private String installerPackage(PackageManager pm, String packageName) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                String installer = pm.getInstallSourceInfo(packageName).getInstallingPackageName();
                return installer == null ? "" : installer;
            }
            String installer = pm.getInstallerPackageName(packageName);
            return installer == null ? "" : installer;
        } catch (Exception ignored) {
            return "";
        }
    }

    private String packageLabel(PackageManager pm, String packageName) {
        try {
            ApplicationInfo app = pm.getApplicationInfo(packageName, 0);
            CharSequence label = pm.getApplicationLabel(app);
            return label == null ? "" : label.toString();
        } catch (PackageManager.NameNotFoundException ignored) {
            return "";
        }
    }

    private JSONObject rootAudit() {
        JSONObject result = new JSONObject();
        JSONArray candidates = new JSONArray();
        for (String path : new String[]{
            "/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su", "/vendor/bin/su"
        }) {
            java.io.File file = new java.io.File(path);
            JSONObject item = new JSONObject();
            put(item, "path", path);
            put(item, "exists", file.exists());
            put(item, "executable", file.canExecute());
            candidates.put(item);
        }
        put(result, "candidates", candidates);
        JSONObject identity = command("su -c id");
        put(result, "identityCheck", identity);
        put(
            result,
            "usable",
            identity.optInt("exitCode", -1) == 0 && identity.optString("stdout", "").contains("uid=0")
        );
        put(result, "readOnlyCommand", "su -c id");
        return result;
    }

    @SuppressLint("QueryPermissionsNeeded")
    private JSONObject resolveDefaultHome(PackageManager pm) {
        JSONObject result = new JSONObject();
        Intent home = new Intent(Intent.ACTION_MAIN);
        home.addCategory(Intent.CATEGORY_HOME);
        ResolveInfo resolved = pm.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
        if (resolved != null && resolved.activityInfo != null) {
            put(result, "package", resolved.activityInfo.packageName);
            put(result, "class", resolved.activityInfo.name);
            put(result, "label", packageLabel(pm, resolved.activityInfo.packageName));
        }
        return result;
    }

    @SuppressLint("QueryPermissionsNeeded")
    private JSONArray technicalBootReceivers(PackageManager pm) {
        JSONArray result = new JSONArray();
        Intent boot = new Intent(Intent.ACTION_BOOT_COMPLETED);
        List<ResolveInfo> receivers = pm.queryBroadcastReceivers(boot, PackageManager.MATCH_DISABLED_COMPONENTS);
        for (ResolveInfo receiver : receivers) {
            if (receiver.activityInfo == null) continue;
            String packageName = receiver.activityInfo.packageName;
            String label = packageLabel(pm, packageName);
            if (!isTechnicalName(packageName) && !isTechnicalName(label)) continue;
            JSONObject item = new JSONObject();
            put(item, "package", packageName);
            put(item, "class", receiver.activityInfo.name);
            put(item, "enabled", receiver.activityInfo.enabled);
            result.put(item);
        }
        return result;
    }

    @SuppressLint("QueryPermissionsNeeded")
    @SuppressWarnings("deprecation")
    private JSONArray technicalPackages(PackageManager pm) {
        JSONArray result = new JSONArray();
        List<PackageInfo> packages = pm.getInstalledPackages(0);
        for (PackageInfo info : packages) {
            if (info == null || info.packageName == null) continue;
            String label = packageLabel(pm, info.packageName);
            if (!isTechnicalName(info.packageName) && !isTechnicalName(label)) continue;
            result.put(packageSummary(pm, info.packageName));
        }
        return result;
    }

    private boolean isTechnicalName(String value) {
        String lower = value == null ? "" : value.toLowerCase(Locale.ROOT);
        return lower.contains("bajie") || lower.contains("charge") || lower.contains("happy")
            || lower.contains("kiosk") || lower.contains("launcher") || lower.contains("updater")
            || lower.contains("devicepolicy") || lower.contains("rockchip") || lower.contains("sumup")
            || lower.contains("stripe") || lower.contains("testtool");
    }

    @SuppressLint("QueryPermissionsNeeded")
    private JSONObject resolvePackageInstaller(PackageManager pm) {
        JSONObject result = new JSONObject();
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(
            Uri.parse("content://ch.chargeurs.kiosk/update.apk"),
            "application/vnd.android.package-archive"
        );
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        ResolveInfo resolved = pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
        if (resolved != null && resolved.activityInfo != null) {
            put(result, "package", resolved.activityInfo.packageName);
            put(result, "class", resolved.activityInfo.name);
            put(result, "label", packageLabel(pm, resolved.activityInfo.packageName));
        }
        return result;
    }

    private JSONObject command(String value) {
        JSONObject result = new JSONObject();
        Process process = null;
        try {
            process = new ProcessBuilder("sh", "-c", value).redirectErrorStream(false).start();
            if (!process.waitFor(4, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                put(result, "timeout", true);
                return result;
            }
            put(result, "exitCode", process.exitValue());
            put(result, "stdout", readLimited(process.getInputStream()));
            put(result, "stderr", readLimited(process.getErrorStream()));
        } catch (Exception error) {
            put(result, "error", error.getClass().getSimpleName());
        } finally {
            if (process != null) process.destroy();
        }
        return result;
    }

    private String readLimited(InputStream input) throws Exception {
        if (input == null) return "";
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int total = 0;
            int count;
            while ((count = source.read(buffer)) != -1) {
                total += count;
                if (total > MAX_OUTPUT_BYTES) {
                    output.write("\n[TRUNCATED]\n".getBytes(StandardCharsets.UTF_8));
                    break;
                }
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private String buildSummary(JSONObject report) {
        JSONObject google = report.optJSONObject("google");
        JSONObject policy = report.optJSONObject("devicePolicy");
        JSONObject root = report.optJSONObject("root");
        JSONObject installation = report.optJSONObject("installation");
        JSONObject startup = report.optJSONObject("startup");

        boolean playServices = installed(google, "playServices");
        boolean playStore = installed(google, "playStore");
        boolean rootUsable = root != null && root.optBoolean("usable", false);
        boolean unknownSources = installation != null
            && installation.optBoolean("canRequestUnknownSourceInstalls", false);
        boolean silent = installation != null
            && installation.optBoolean("silentUpdateTechnicallyPossible", false);
        String owner = policy == null ? "" : policy.optString("deviceOwnerPackage", "");
        JSONObject home = startup == null ? null : startup.optJSONObject("defaultHome");
        String homePackage = home == null ? "inconnu" : home.optString("package", "inconnu");

        return "Services Google : " + mark(playServices)
            + "   •   Play Store : " + mark(playStore)
            + "\nRoot utilisable : " + mark(rootUsable)
            + "   •   Installation APK : " + mark(unknownSources)
            + "\nMise à jour silencieuse : " + (silent ? "possible" : "confirmation nécessaire")
            + "\nAdministrateur principal : " + (owner.isEmpty() ? "non identifié" : owner)
            + "\nÉcran d’accueil Android : " + homePackage;
    }

    private boolean installed(JSONObject parent, String key) {
        JSONObject value = parent == null ? null : parent.optJSONObject(key);
        return value != null && value.optBoolean("installed", false);
    }

    private String mark(boolean value) {
        return value ? "présent" : "absent";
    }

    private void openUnknownSourcesSettings() {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName())
                );
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            startActivity(intent);
        } catch (RuntimeException error) {
            Toast.makeText(this, "Le menu est bloqué par la tablette.", Toast.LENGTH_LONG).show();
        }
    }

    private void openVendorApp() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(VENDOR_PACKAGE);
        if (launch == null) {
            Toast.makeText(this, "Application fournisseur introuvable.", Toast.LENGTH_LONG).show();
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(launch);
    }

    private void exportReport() {
        if (latestReport == null) return;
        exportButton.setEnabled(false);
        executor.execute(() -> {
            try {
                String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
                String filename = "DTA21269-inspection-tablette-" + stamp + ".json";
                Uri uri = saveToDownloads(filename, latestReport.toString(2));
                runOnUiThread(() -> {
                    exportButton.setEnabled(true);
                    Toast.makeText(this, "Rapport créé dans Téléchargements/Chargeurs.", Toast.LENGTH_LONG).show();
                    if (uri != null) shareReport(uri, filename);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    exportButton.setEnabled(true);
                    Toast.makeText(this, "Impossible d’exporter le rapport.", Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private Uri saveToDownloads(String filename, String content) throws Exception {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Chargeurs");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("DOWNLOAD_INSERT_FAILED");
            try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                if (output == null) throw new IllegalStateException("DOWNLOAD_OPEN_FAILED");
                output.write(bytes);
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.Downloads.IS_PENDING, 0);
            getContentResolver().update(uri, ready, null, null);
            return uri;
        }
        java.io.File directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (directory == null) throw new IllegalStateException("DOWNLOAD_DIRECTORY_UNAVAILABLE");
        java.io.File file = new java.io.File(directory, filename);
        try (java.io.FileOutputStream output = new java.io.FileOutputStream(file)) {
            output.write(bytes);
        }
        return null;
    }

    private void shareReport(Uri uri, String filename) {
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("application/json");
        share.putExtra(Intent.EXTRA_STREAM, uri);
        share.putExtra(Intent.EXTRA_SUBJECT, "Inspection tablette " + STATION_ID);
        share.putExtra(Intent.EXTRA_TEXT, "Rapport d’inspection Android de la borne " + STATION_ID + ".");
        share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(share, "Envoyer " + filename));
    }

    private Button actionButton(String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(16);
        button.setAllCaps(false);
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private LinearLayout.LayoutParams fullButton() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58));
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

    private static void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value == null ? JSONObject.NULL : value);
        } catch (Exception ignored) {
            // Best-effort audit field.
        }
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
