package ch.chargeurs.kiosk;

import android.content.Context;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;

import org.json.JSONObject;

/**
 * Non-invasive field probe for the target BBPOS WisePad 3.
 *
 * This class never requests, revokes or transfers USB permission. It only
 * inspects Android's USB device inventory so the TEST UI can distinguish
 * READER_PRESENT from QR_ONLY without disturbing the supplier POS owner.
 */
public final class WisePadUsbProbe {
    public static final int TARGET_VENDOR_ID = 0x15A2;
    public static final int TARGET_PRODUCT_ID = 0x0101;

    private WisePadUsbProbe() {}

    public static JSONObject snapshot(Context context) {
        UsbManager manager = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        if (manager == null) {
            return JsonObjects.of(
                "state", "ERROR",
                "transport", "usb",
                "targetVid", "15a2",
                "targetPid", "0101",
                "present", false,
                "permission", false,
                "code", "USB_MANAGER_UNAVAILABLE"
            );
        }

        for (UsbDevice device : manager.getDeviceList().values()) {
            if (device.getVendorId() == TARGET_VENDOR_ID && device.getProductId() == TARGET_PRODUCT_ID) {
                return JsonObjects.of(
                    "state", "READER_PRESENT",
                    "transport", "usb",
                    "targetVid", "15a2",
                    "targetPid", "0101",
                    "present", true,
                    "permission", manager.hasPermission(device),
                    "deviceId", device.getDeviceId(),
                    "deviceName", device.getDeviceName(),
                    "productName", device.getProductName() == null ? "WisePad 3" : device.getProductName(),
                    "manufacturer", device.getManufacturerName() == null ? "BBPOS" : device.getManufacturerName()
                );
            }
        }

        return JsonObjects.of(
            "state", "USB_ABSENT",
            "transport", "usb",
            "targetVid", "15a2",
            "targetPid", "0101",
            "present", false,
            "permission", false
        );
    }
}
