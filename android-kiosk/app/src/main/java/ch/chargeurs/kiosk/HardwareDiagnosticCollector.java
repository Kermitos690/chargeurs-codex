package ch.chargeurs.kiosk;

import android.content.Context;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Environment;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Map;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

public final class HardwareDiagnosticCollector {
    private HardwareDiagnosticCollector() {}

    public static JSONObject collect(Context context) {
        JSONObject report = new JSONObject();
        put(report, "generatedAt", System.currentTimeMillis());
        put(report, "appVersion", BuildConfig.VERSION_NAME);
        put(report, "device", deviceInfo());
        put(report, "vendorApp", VendorAppCompatibility.inspect(context));
        put(report, "chargeursApp", packageInfo(context, context.getPackageName()));
        SecureConfigStore.StorageHealth storage = new SecureConfigStore(context).inspect();
        put(report, "secureStorage", JsonObjects.of(
            "ready", storage.isReady(),
            "status", storage.code(),
            "compatibilityMode", storage.mode(),
            "failureKind", storage.failureKind(),
            "repairApplied", storage.wasRepaired(),
            "containsToken", false
        ));
        put(report, "usb", usbInfo(context));
        put(report, "tty", ttyInfo());
        put(report, "procTtyDrivers", command("cat /proc/tty/drivers"));
        put(report, "serialProperties", "REDACTED_TO_AVOID_DEVICE_IDENTIFIERS");
        put(report, "bajieConfig", configInfo());
        put(report, "integrationReadiness", JsonObjects.of(
            "cloudApi", "BACKEND_ONLY",
            "localDtaBridge", "NOT_CONFIGURED",
            "physicalControl", "REQUIRES_OFFICIAL_VENDOR_CONTRACT"
        ));
        put(report, "safeReadOnly", true);
        return report;
    }

    private static JSONObject deviceInfo() {
        JSONObject value = new JSONObject();
        put(value, "manufacturer", Build.MANUFACTURER);
        put(value, "brand", Build.BRAND);
        put(value, "model", Build.MODEL);
        put(value, "device", Build.DEVICE);
        put(value, "product", Build.PRODUCT);
        put(value, "hardware", Build.HARDWARE);
        put(value, "board", Build.BOARD);
        put(value, "fingerprint", Build.FINGERPRINT);
        put(value, "sdk", Build.VERSION.SDK_INT);
        put(value, "release", Build.VERSION.RELEASE);
        put(value, "supportedAbis", new JSONArray(Arrays.asList(Build.SUPPORTED_ABIS)));
        return value;
    }

    private static JSONObject packageInfo(Context context, String packageName) {
        JSONObject result = new JSONObject();
        put(result, "package", packageName);
        try {
            android.content.pm.PackageInfo info = context.getPackageManager().getPackageInfo(packageName, 0);
            put(result, "installed", true);
            put(result, "versionName", info.versionName == null ? "" : info.versionName);
            put(result, "versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            put(result, "firstInstallTime", info.firstInstallTime);
            put(result, "lastUpdateTime", info.lastUpdateTime);
        } catch (android.content.pm.PackageManager.NameNotFoundException ignored) {
            put(result, "installed", false);
        }
        return result;
    }

    private static JSONArray usbInfo(Context context) {
        JSONArray devices = new JSONArray();
        UsbManager manager = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        if (manager == null) return devices;
        for (Map.Entry<String, UsbDevice> entry : manager.getDeviceList().entrySet()) {
            UsbDevice device = entry.getValue();
            JSONObject item = new JSONObject();
            put(item, "name", entry.getKey());
            put(item, "vendorId", device.getVendorId());
            put(item, "productId", device.getProductId());
            put(item, "deviceClass", device.getDeviceClass());
            put(item, "interfaces", device.getInterfaceCount());
            put(item, "permission", manager.hasPermission(device));
            devices.put(item);
        }
        return devices;
    }

    private static JSONArray ttyInfo() {
        JSONArray result = new JSONArray();
        File[] files = new File("/dev").listFiles((dir, name) -> {
            String lower = name.toLowerCase(Locale.ROOT);
            return lower.startsWith("tty") || lower.contains("serial") || lower.contains("uart") || lower.contains("rs485") || lower.contains("wch");
        });
        if (files == null) return result;
        Arrays.sort(files, Comparator.comparing(File::getName));
        for (File file : files) {
            JSONObject item = new JSONObject();
            put(item, "path", file.getAbsolutePath());
            put(item, "readable", file.canRead());
            put(item, "writable", file.canWrite());
            put(item, "driver", canonical(new File("/sys/class/tty/" + file.getName() + "/device/driver")));
            put(item, "uevent", command("cat '/sys/class/tty/" + file.getName() + "/device/uevent'"));
            result.put(item);
        }
        return result;
    }

    private static JSONArray configInfo() {
        JSONArray result = new JSONArray();
        for (String path : new String[]{
            new File(Environment.getExternalStorageDirectory(), "Documents/bajie_config").getPath(),
            "/storage/emulated/0/Documents/bajie_config"
        }) {
            File directory = new File(path);
            JSONObject item = new JSONObject();
            put(item, "path", path);
            put(item, "exists", directory.exists());
            put(item, "readable", directory.canRead());
            File[] files = directory.listFiles();
            // Do not enumerate names or contents from another application's
            // shared configuration directory. File names can contain account
            // identifiers or implementation details and are not needed to
            // decide whether a documented bridge is available.
            put(item, "entryCount", files == null ? 0 : files.length);
            put(item, "contents", "NOT_READ");
            result.put(item);
        }
        return result;
    }

    private static JSONObject command(String value) {
        JSONObject result = new JSONObject();
        Process process = null;
        try {
            process = new ProcessBuilder("sh", "-c", value).redirectErrorStream(false).start();
            if (!process.waitFor(3, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                put(result, "timeout", true);
                return result;
            }
            put(result, "exitCode", process.exitValue());
            put(result, "stdout", read(process.getInputStream()));
            put(result, "stderr", read(process.getErrorStream()));
        } catch (Exception error) {
            put(result, "error", error.getClass().getSimpleName());
        } finally {
            if (process != null) process.destroy();
        }
        return result;
    }

    private static String read(java.io.InputStream input) throws Exception {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input))) {
            String line;
            int count = 0;
            while ((line = reader.readLine()) != null && count++ < 400) builder.append(line).append('\n');
        }
        return builder.toString();
    }

    private static String canonical(File file) {
        try { return file.getCanonicalPath(); }
        catch (Exception ignored) { return file.getAbsolutePath(); }
    }

    private static void put(JSONObject object, String key, Object value) {
        try { object.put(key, value); }
        catch (Exception ignored) { }
    }
}
