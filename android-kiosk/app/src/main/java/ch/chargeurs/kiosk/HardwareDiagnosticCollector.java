package ch.chargeurs.kiosk;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.FeatureInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public final class HardwareDiagnosticCollector {
    private static final String VENDOR_PACKAGE = "com.szbjkj.bajietouchpower";
    private static final int MAX_COMMAND_LINES = 250;
    private static final int MAX_COMMAND_CHARS = 48 * 1024;

    private HardwareDiagnosticCollector() {}

    public static JSONObject collect(Context context) {
        Context app = context.getApplicationContext();
        JSONObject report = new JSONObject();
        put(report, "schemaVersion", 2);
        put(report, "generatedAt", System.currentTimeMillis());
        put(report, "elapsedRealtimeMs", SystemClock.elapsedRealtime());
        put(report, "appVersion", BuildConfig.VERSION_NAME);
        put(report, "devicePublicId", DeviceIdentity.getOrCreate(app));
        put(report, "device", deviceInfo());
        put(report, "vendorApp", packageInfo(app, VENDOR_PACKAGE));
        put(report, "chargeursApp", packageInfo(app, app.getPackageName()));
        put(report, "runningProcesses", runningProcesses(app));
        put(report, "hardwareFeatures", hardwareFeatures(app));
        put(report, "connectivity", connectivityInfo(app));
        put(report, "networkInterfaces", networkInterfaces());
        put(report, "usb", usbInfo(app));
        put(report, "tty", ttyInfo());
        put(report, "kernel", command("uname -a"));
        put(report, "selinux", command("getenforce"));
        put(report, "processIdentity", command("id"));
        put(report, "uptime", command("cat /proc/uptime"));
        put(report, "procTtyDrivers", command("cat /proc/tty/drivers"));
        put(report, "serialProperties", command("getprop | grep -Ei 'serial|uart|tty|rs485|dta|bajie|wch'"));
        put(report, "hardwareServices", command("service list | grep -Ei 'serial|uart|rs485|usb|device'"));
        put(report, "usbDump", command("dumpsys usb"));
        put(report, "networkAddress", command("ip -details address"));
        put(report, "networkRoutes", command("ip route show table all"));
        put(report, "networkSockets", command("ss -tunap 2>/dev/null || netstat -tunap 2>/dev/null"));
        put(report, "procNetTcp", command("cat /proc/net/tcp /proc/net/tcp6"));
        put(report, "procNetUdp", command("cat /proc/net/udp /proc/net/udp6"));
        put(report, "processList", command("ps -A -o USER,PID,PPID,NAME"));
        put(report, "vendorPackageDump", command(
            "dumpsys package " + VENDOR_PACKAGE
                + " | grep -Ei 'versionName|versionCode|codePath|nativeLibraryDir|permission|receiver|service|activity'"
        ));
        put(report, "bajieConfig", configInfo());
        put(report, "safeReadOnly", true);
        put(report, "serialBytesWritten", 0);
        put(report, "vendorPayloadCaptured", false);
        put(report, "credentialsCollected", false);
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
        put(value, "bootloader", Build.BOOTLOADER);
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
            PackageInfo info = context.getPackageManager().getPackageInfo(
                packageName,
                PackageManager.GET_PERMISSIONS
            );
            put(result, "installed", true);
            put(result, "enabled", info.applicationInfo != null && info.applicationInfo.enabled);
            put(result, "versionName", info.versionName == null ? "" : info.versionName);
            put(result, "versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            put(result, "firstInstallTime", info.firstInstallTime);
            put(result, "lastUpdateTime", info.lastUpdateTime);
            put(result, "sourceDir", info.applicationInfo == null ? "" : info.applicationInfo.sourceDir);
            put(result, "nativeLibraryDir", info.applicationInfo == null ? "" : info.applicationInfo.nativeLibraryDir);
            put(result, "requestedPermissions", new JSONArray(
                info.requestedPermissions == null
                    ? Collections.emptyList()
                    : Arrays.asList(info.requestedPermissions)
            ));
        } catch (PackageManager.NameNotFoundException ignored) {
            put(result, "installed", false);
        }
        return result;
    }

    private static JSONArray runningProcesses(Context context) {
        JSONArray result = new JSONArray();
        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null) return result;
        List<ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
        if (processes == null) return result;
        for (ActivityManager.RunningAppProcessInfo process : processes) {
            if (process == null || process.processName == null) continue;
            String lower = process.processName.toLowerCase();
            if (!lower.contains("bajie") && !lower.contains("charge") && !lower.contains("szbjkj")) continue;
            JSONObject item = new JSONObject();
            put(item, "processName", process.processName);
            put(item, "pid", process.pid);
            put(item, "importance", process.importance);
            put(item, "packages", new JSONArray(
                process.pkgList == null ? Collections.emptyList() : Arrays.asList(process.pkgList)
            ));
            result.put(item);
        }
        return result;
    }

    private static JSONArray hardwareFeatures(Context context) {
        JSONArray result = new JSONArray();
        FeatureInfo[] features = context.getPackageManager().getSystemAvailableFeatures();
        if (features == null) return result;
        for (FeatureInfo feature : features) {
            JSONObject item = new JSONObject();
            put(item, "name", feature.name == null ? "opengles" : feature.name);
            put(item, "version", feature.version);
            put(item, "glEsVersion", feature.getGlEsVersion());
            result.put(item);
        }
        return result;
    }

    private static JSONObject connectivityInfo(Context context) {
        JSONObject result = new JSONObject();
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return result;
        Network network = manager.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : manager.getNetworkCapabilities(network);
        put(result, "active", network != null);
        if (capabilities == null) return result;
        put(result, "internet", capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET));
        put(result, "validated", capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
        put(result, "notMetered", capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED));
        put(result, "wifi", capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI));
        put(result, "ethernet", capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
        put(result, "cellular", capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR));
        put(result, "vpn", capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN));
        put(result, "downstreamKbps", capabilities.getLinkDownstreamBandwidthKbps());
        put(result, "upstreamKbps", capabilities.getLinkUpstreamBandwidthKbps());
        return result;
    }

    private static JSONArray networkInterfaces() {
        JSONArray result = new JSONArray();
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            interfaces.sort(Comparator.comparing(NetworkInterface::getName));
            for (NetworkInterface network : interfaces) {
                JSONObject item = new JSONObject();
                put(item, "name", network.getName());
                put(item, "displayName", network.getDisplayName());
                put(item, "up", network.isUp());
                put(item, "loopback", network.isLoopback());
                put(item, "virtual", network.isVirtual());
                put(item, "mtu", network.getMTU());
                JSONArray addresses = new JSONArray();
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    addresses.put(address.getHostAddress());
                }
                put(item, "addresses", addresses);
                result.put(item);
            }
        } catch (Exception error) {
            JSONObject item = new JSONObject();
            put(item, "error", error.getClass().getSimpleName());
            result.put(item);
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
            put(item, "deviceSubclass", device.getDeviceSubclass());
            put(item, "deviceProtocol", device.getDeviceProtocol());
            put(item, "interfaces", device.getInterfaceCount());
            put(item, "permission", manager.hasPermission(device));
            devices.put(item);
        }
        return devices;
    }

    private static JSONArray ttyInfo() {
        JSONArray result = new JSONArray();
        File[] files = new File("/dev").listFiles((dir, name) -> {
            String lower = name.toLowerCase();
            return lower.startsWith("tty") || lower.contains("serial") || lower.contains("uart")
                || lower.contains("rs485") || lower.contains("wch");
        });
        if (files == null) return result;
        Arrays.sort(files, Comparator.comparing(File::getName));
        for (File file : files) {
            JSONObject item = new JSONObject();
            put(item, "path", file.getAbsolutePath());
            put(item, "readable", file.canRead());
            put(item, "writable", file.canWrite());
            put(item, "length", file.length());
            put(item, "lastModified", file.lastModified());
            put(item, "driver", canonical(new File("/sys/class/tty/" + file.getName() + "/device/driver")));
            put(item, "uevent", command("cat '/sys/class/tty/" + file.getName() + "/device/uevent'"));
            result.put(item);
        }
        return result;
    }

    private static JSONArray configInfo() {
        JSONArray result = new JSONArray();
        for (String path : new String[]{
            "/sdcard/Documents/bajie_config",
            "/storage/emulated/0/Documents/bajie_config",
            "/mnt/sdcard/Documents/bajie_config"
        }) {
            File directory = new File(path);
            JSONObject item = new JSONObject();
            put(item, "path", path);
            put(item, "exists", directory.exists());
            put(item, "readable", directory.canRead());
            put(item, "writable", directory.canWrite());
            JSONArray entries = new JSONArray();
            File[] files = directory.listFiles();
            if (files != null) {
                Arrays.sort(files, Comparator.comparing(File::getName));
                for (File file : files) {
                    JSONObject child = new JSONObject();
                    put(child, "name", file.getName());
                    put(child, "directory", file.isDirectory());
                    put(child, "readable", file.canRead());
                    put(child, "writable", file.canWrite());
                    put(child, "length", file.length());
                    put(child, "lastModified", file.lastModified());
                    put(child, "contentRead", false);
                    entries.put(child);
                }
            }
            put(item, "entries", entries);
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
            while ((line = reader.readLine()) != null && count++ < MAX_COMMAND_LINES) {
                if (builder.length() + line.length() + 1 > MAX_COMMAND_CHARS) {
                    builder.append("[TRUNCATED]\n");
                    break;
                }
                builder.append(line).append('\n');
            }
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
