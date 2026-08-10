package ch.chargeurs.kiosk;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONObject;

/**
 * Non-invasive compatibility report for the Bajie/ChargeNow Android agent.
 *
 * Android applications are sandboxed: seeing another installed package does
 * not grant access to its process, private files, serial connection, tokens or
 * vendor IPC. This class intentionally reads package metadata only. It never
 * launches, stops, binds to, reads from, or otherwise controls the vendor app.
 */
public final class VendorAppCompatibility {
    public static final String VENDOR_PACKAGE = "com.szbjkj.bajietouchpower";

    private VendorAppCompatibility() {}

    public static JSONObject inspect(Context context) {
        JSONObject result = new JSONObject();
        put(result, "packageName", VENDOR_PACKAGE);
        put(result, "inspection", "PACKAGE_METADATA_ONLY");
        put(result, "networkConnectionState", "NOT_OBSERVABLE_FROM_ANOTHER_APP");
        put(result, "publicBridgeStatus", "NOT_OBSERVED_IN_STATIC_MANIFEST");
        put(result, "localProtocolStatus", "NOT_CONFIGURED");
        put(result, "canReuseVendorConnection", false);
        put(result, "requiredForPhysicalControl", "OFFICIAL_VENDOR_SDK_OR_SYSTEM_SERVICE_OR_DOCUMENTED_DTA_PROTOCOL");

        try {
            PackageManager packageManager = context.getPackageManager();
            PackageInfo info = packageManager.getPackageInfo(VENDOR_PACKAGE, 0);
            ApplicationInfo application = info.applicationInfo;
            boolean enabled = application != null && application.enabled;
            boolean launchable = packageManager.getLaunchIntentForPackage(VENDOR_PACKAGE) != null;
            boolean systemApp = application != null
                && (application.flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0;

            put(result, "installed", true);
            put(result, "enabled", enabled);
            put(result, "launchable", launchable);
            put(result, "systemApp", systemApp);
            put(result, "versionName", info.versionName == null ? "" : info.versionName);
            put(result, "versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode() : info.versionCode);
            put(result, "state", classify(true, enabled, launchable));
        } catch (PackageManager.NameNotFoundException ignored) {
            put(result, "installed", false);
            put(result, "enabled", false);
            put(result, "launchable", false);
            put(result, "systemApp", false);
            put(result, "state", classify(false, false, false));
        } catch (RuntimeException ignored) {
            put(result, "installed", false);
            put(result, "state", "VENDOR_APP_STATUS_UNAVAILABLE");
        }
        return result;
    }

    static String classify(boolean installed, boolean enabled, boolean launchable) {
        if (!installed) return "VENDOR_APP_NOT_INSTALLED";
        if (!enabled) return "VENDOR_APP_DISABLED";
        if (!launchable) return "VENDOR_APP_PRESENT_NO_LAUNCHER";
        return "VENDOR_APP_PRESENT_NO_PUBLIC_BRIDGE";
    }

    private static void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value);
        } catch (Exception ignored) {
            // Diagnostics must never bring down the kiosk process.
        }
    }
}
