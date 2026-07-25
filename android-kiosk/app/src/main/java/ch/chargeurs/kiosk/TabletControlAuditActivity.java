package ch.chargeurs.kiosk;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
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
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class TabletControlAuditActivity extends Activity {
    private static final String STATION_ID = "DTA21269";
    private static final String VENDOR_PACKAGE = "com.szbjkj.bajietouchpower";
    private static final String GOOGLE_PLAY_SERVICES = "com.google.android.gms";
    private static final String GOOGLE_PLAY_STORE = "com.android.vending";
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
            "Borne " + STATION_ID + " — contrôle du verrouillage Android, des mises à jour et du mode kiosque. "
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

        Button unknownSourcesButton = actionButton(
            "Ouvrir l’autorisation d’installation APK",
            this::openUnknownSourcesSettings
        );
        LinearLayout.LayoutParams unknownParams = fullButton();
        unknownParams.setMargins(0, dp(10), 0, 0);
        content.addView(unknownSourcesButton, unknownParams);

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
                String formatted = report.toString(2);
                String human = buildSummary(report);
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
        report.put("schemaVersion", 1);
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
        device.put("abis", new JSONArray(Arrays.asList(Build.SUPPORTED_ABIS)));
        device.put("adbEnabled", globalSetting(Settings.Global.ADB_ENABLED));
        device.put("developerOptionsEnabled", globalSetting(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED));
        device.put("usbConfig", command("getprop sys.usb.config"));
        report.put("device", device);

        JSONObject google = new JSONObject();
        google.put("playServices", packageSummary(pm, GOOGLE_PLAY_SERVICES));
        google.put("playStore", packageSummary(pm, GOOGLE_PLAY_STORE));
        google.put("googleServicesFramework", packageSummary(pm, "com.google.android.gsf"));
        report.put("google", google);

        JSONObject vendor = packageSummary(pm, VENDOR_PACKAGE);
        report.put("vendorApplication", vendor);
        report.put("chargeursInspector", packageSummary(pm, getPackageName()));

        JSONObject policy = new JSONObject();
        ComponentName owner = null;
        if (dpm != null) {
            try {
                owner = dpm.getDeviceOwnerComponentOnAnyUser();
            } catch (RuntimeException error) {
                policy.put("deviceOwnerLookupError", error.getClass().getSimpleName());
            }
            policy.put("selfIsDeviceOwner", dpm.isDeviceOwnerApp(getPackageName()));
            policy.put("selfIsProfileOwner", dpm.isProfileOwnerApp(getPackageName()));
            policy.put("selfLockTaskPermitted", dpm.isLockTaskPermitted(getPackageName()));
            policy.put("vendorLockTaskPermitted", dpm.isLockTaskPermitted(VENDOR_PACKAGE));
            JSONArray admins = new JSONArray();
            List<ComponentName> activeAdmins = dpm.getActiveAdmins();
            if (activeAdmins != null) {
                for (ComponentName admin : activeAdmins) admins.put(component(admin));
            }
            policy.put("activeAdmins", admins);
        }
        policy.put("deviceOwner", owner == null ? JSONObject.NULL : component(owner));
        policy.put("deviceOwnerPackage", owner == null ? "" : owner.getPackageName());
        policy.put("deviceOwnerLabel", owner == null ? "" : packageLabel(pm, owner.getPackageName()));
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

        JSONObject installation = new JSONObject();
        boolean canRequestInstalls = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || pm.canRequestPackageInstalls();
        boolean installPermission = checkSelfPermission("android.permission.INSTALL_PACKAGES")
            == PackageManager.PERMISSION_GRANTED;
        boolean selfSystemApp = (getApplicationInfo().flags & ApplicationInfo.FLAG_SYSTEM) != 0;
        boolean selfDeviceOwner = dpm != null && dpm.isDeviceOwnerApp(getPackageName());
        boolean rootUsable = root.optBoolean("usable", false);
        installation.put("canRequestUnknownSourceInstalls", canRequestInstalls);
        installation.put("holdsInstallPackagesPermission", installPermission);
        installation.put("selfIsSystemApp", selfSystemApp);
        installation.put("selfIsDeviceOwner", selfDeviceOwner);
        installation.put("rootUsable", rootUsable);
        installation.put("silentUpdateTechnicallyPossible", rootUsable || installPermission || selfDeviceOwner);
        installation.put("silentUpdateReason",
            rootUsable ? "root_available"
                : installPermission ? "install_packages_permission"
                : selfDeviceOwner ? "device_owner"
                : "manual_confirmation_required"
        );
        installation.put("packageInstaller", resolvePackageInstaller(pm));
        report.put("installation", installation);

        JSONObject launcher = new JSONObject();
        launcher.put("defaultHome", resolveDefaultHome(pm));
        launcher.put("bootReceivers", queryBootReceivers(pm));
        report.put("startup", launcher);

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
        JSONObject result = new JSONObject();
        put(result, "package", packageName);
        try {
            int flags = PackageManager.GET_PERMISSIONS | PackageManager.GET_SERVICES
                | PackageManager.GET_RECEIVERS;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                flags |= PackageManager.GET_SIGNING_CERTIFICATES;
            } else {
                flags |= PackageManager.GET_SIGNATURES;
            }
            PackageInfo info = pm.getPackageInfo(packageName, flags);
            ApplicationInfo app = info.applicationInfo;
            put(result, "installed", true);
            put(result, "enabled", app != null && app.enabled);
            put(result, "label", packageLabel(pm, packageName));
            put(result, "versionName", info.versionName == null ? "" : info.versionName);
            put(result, "versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            put(result, "firstInstallTime", info.firstInstallTime);
            put(result, "lastUpdateTime", info.lastUpdateTime);
            put(result, "sourceDir", app == null ? "" : app.sourceDir);
            put(result, "systemApp", app != null && (app.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
            put(result, "installerPackage", installerPackage(pm, packageName));
            put(result, "signerSha256", signerSha256(info));
            put(result, "services", componentNames(info.services));
            put(result, "receivers", componentNames(info.receivers));
            put(result, "requestedPermissions", new JSONArray(
                info.requestedPermissions == null
                    ? Collections.emptyList()
                    : Arrays.asList(info.requestedPermissions)
            ));
        } catch (PackageManager.NameNotFoundException error) {
            put(result, "installed", false);
        }
        return result;
    }

    private JSONArray componentNames(ActivityInfo[] values) {
        JSONArray result = new JSONArray();
        if (values == null) return result;
        for (ActivityInfo value : values) {
            if (value != null) result.put(value.name);
        }
        return result;
    }

    private JSONArray componentNames(android.content.pm.ServiceInfo[] values) {
        JSONArray result = new JSONArray();
        if (values == null) return result;
        for (android.content.pm.ServiceInfo value : values) {
            if (value != null) result.put(value.name);
        }
        return result;
    }

    @SuppressWarnings("deprecation")
    private String installerPackage(PackageManager pm, String packageName) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                return pm.getInstallSourceInfo(packageName).getInstallingPackageName();
            }
            return pm.getInstallerPackageName(packageName);
        } catch (Exception ignored) {
            return "";
        }
    }

    @SuppressWarnings("deprecation")
    private String signerSha256(PackageInfo info) {
        try {
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                SigningInfo signingInfo = info.signingInfo;
                signatures = signingInfo == null ? null : signingInfo.getApkContentsSigners();
            } else {
                signatures = info.signatures;
            }
            if (signatures == null || signatures.length == 0) return "";
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray());
            StringBuilder value = new StringBuilder();
            for (byte item : digest) value.append(String.format(Locale.US, "%02x", item));
            return value.toString();
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

    private JSONObject component(ComponentName value) {
        JSONObject result = new JSONObject();
        put(result, "package", value.getPackageName());
        put(result, "class", value.getClassName());
        return result;
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
        String stdout = identity.optString("stdout", "");
        put(result, "usable", identity.optInt("exitCode", -1) == 0 && stdout.contains("uid=0"));
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
    private JSONArray queryBootReceivers(PackageManager pm) {
        JSONArray result = new JSONArray();
        Intent boot = new Intent(Intent.ACTION_BOOT_COMPLETED);
        List<ResolveInfo> receivers = pm.queryBroadcastReceivers(boot, PackageManager.MATCH_DISABLED_COMPONENTS);
        for (ResolveInfo receiver : receivers) {
            if (receiver.activityInfo == null) continue;
            String packageName = receiver.activityInfo.packageName;
            String lower = packageName.toLowerCase(Locale.ROOT);
            if (!isTechnicalName(lower)) continue;
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
        Set<String> added = new HashSet<>();
        List<PackageInfo> packages = pm.getInstalledPackages(0);
        for (PackageInfo info : packages) {
            if (info == null || info.packageName == null) continue;
            String lower = info.packageName.toLowerCase(Locale.ROOT);
            String label = packageLabel(pm, info.packageName).toLowerCase(Locale.ROOT);
            if (!isTechnicalName(lower) && !isTechnicalName(label)) continue;
            if (!added.add(info.packageName)) continue;
            result.put(packageSummary(pm, info.packageName));
        }
        return result;
    }

    private boolean isTechnicalName(String value) {
        return value.contains("bajie") || value.contains("charge") || value.contains("happy")
            || value.contains("kiosk") || value.contains("launcher") || value.contains("updater")
            || value.contains("devicepolicy") || value.contains("rockchip") || value.contains("sumup")
            || value.contains("stripe") || value.contains("testtool");
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
        if (parent == null) return false;
        JSONObject value = parent.optJSONObject(key);
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
            values.put(
                MediaStore.Downloads.RELATIVE_PATH,
                Environment.DIRECTORY_DOWNLOADS + "/Chargeurs"
            );
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
        share.putExtra(
            Intent.EXTRA_TEXT,
            "Rapport d’inspection Android et de capacité de mise à jour de la borne " + STATION_ID + "."
        );
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
