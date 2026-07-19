package ch.chargeurs.kiosk;

import org.json.JSONObject;

public final class HardwareCommandResult {
    private final boolean ok;
    private final String code;
    private final String commandId;
    private final int slot;

    public HardwareCommandResult(boolean ok, String code, String commandId, int slot) {
        this.ok = ok;
        this.code = code;
        this.commandId = commandId;
        this.slot = slot;
    }

    public boolean ok() {
        return ok;
    }

    public String code() {
        return code;
    }

    public JSONObject json() {
        return JsonObjects.of(
            "ok", ok,
            "code", code,
            "commandId", commandId,
            "slot", slot
        );
    }
}
