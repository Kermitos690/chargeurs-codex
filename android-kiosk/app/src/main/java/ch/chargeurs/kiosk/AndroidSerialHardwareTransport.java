package ch.chargeurs.kiosk;

import android.content.Context;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.Map;

/**
 * Read-only transport probe until the authorized BJP/DTA/RS485 framing and
 * device permission contract are supplied. It deliberately never calls su,
 * chmod or writes guessed bytes to a serial device.
 */
public final class AndroidSerialHardwareTransport implements HardwareTransport {
    private static final String[] SERIAL_CANDIDATES = {
        "/dev/ttyWCHUSB0", "/dev/ttyWCHUSB1", "/dev/ttyWCHUSB2", "/dev/ttyWCHUSB3",
        "/dev/ttyWCHUSB8", "/dev/ttyWCHUSB9", "/dev/ttyWCHUSB10", "/dev/ttyWCHUSB11",
        "/dev/ttyHS1", "/dev/ttyHS2", "/dev/ttyHSL0", "/dev/ttyS1", "/dev/ttyS4"
    };

    private final Context context;

    public AndroidSerialHardwareTransport(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public boolean isReady() {
        return false;
    }

    @Override
    public JSONObject status() {
        JSONArray serial = new JSONArray();
        for (String path : SERIAL_CANDIDATES) {
            File candidate = new File(path);
            if (candidate.exists()) {
                serial.put(JsonObjects.of(
                    "path", path,
                    "readable", candidate.canRead(),
                    "writable", candidate.canWrite()
                ));
            }
        }

        JSONArray usb = new JSONArray();
        UsbManager manager = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        if (manager != null) {
            for (Map.Entry<String, UsbDevice> entry : manager.getDeviceList().entrySet()) {
                UsbDevice device = entry.getValue();
                usb.put(JsonObjects.of(
                    "vendorId", device.getVendorId(),
                    "productId", device.getProductId(),
                    "interfaces", device.getInterfaceCount(),
                    "permission", manager.hasPermission(device)
                ));
            }
        }

        return JsonObjects.of(
            "state", "NOT_CONFIGURED",
            "protocol", "NOT_CONFIGURED",
            "serialCandidates", serial,
            "usbDevices", usb,
            "rootWorkaroundsUsed", false
        );
    }

    @Override
    public byte[] transact(byte[] request, int timeoutMs) {
        throw new IllegalStateException("CABINET_TRANSPORT_NOT_CONFIGURED");
    }
}
