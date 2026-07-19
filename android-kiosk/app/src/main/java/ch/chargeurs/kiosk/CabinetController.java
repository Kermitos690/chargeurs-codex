package ch.chargeurs.kiosk;

import org.json.JSONObject;

/** Mono-writer boundary for all future cabinet commands. */
public final class CabinetController {
    private final HardwareTransport transport;
    private final CabinetProtocolAdapter protocol;

    public CabinetController(HardwareTransport transport, CabinetProtocolAdapter protocol) {
        this.transport = transport;
        this.protocol = protocol;
    }

    public synchronized HardwareCommandResult eject(EjectionAuthorization authorization) {
        int slot = authorization.slot();
        String commandId = authorization.commandId();
        if (slot < 1 || slot > 128) return new HardwareCommandResult(false, "INVALID_SLOT", commandId, slot);
        if (!protocol.isConfigured()) return new HardwareCommandResult(false, "CABINET_PROTOCOL_NOT_CONFIGURED", commandId, slot);
        if (!transport.isReady()) return new HardwareCommandResult(false, "CABINET_TRANSPORT_NOT_READY", commandId, slot);

        try {
            byte[] request = protocol.createEjectRequest(slot, commandId);
            byte[] response = transport.transact(request, 8_000);
            boolean confirmed = protocol.isSuccessfulEjectResponse(response, slot, commandId);
            return new HardwareCommandResult(confirmed, confirmed ? "EJECT_CONFIRMED" : "EJECT_NOT_CONFIRMED", commandId, slot);
        } catch (Exception ignored) {
            return new HardwareCommandResult(false, "EJECT_TRANSPORT_ERROR", commandId, slot);
        }
    }

    public JSONObject status() {
        JSONObject transportStatus = transport.status();
        return JsonObjects.of(
            "transport", transportStatus,
            "protocol", protocol.protocolName(),
            "commandMode", protocol.isConfigured() ? "SIGNED_ONLY" : "NOT_CONFIGURED"
        );
    }
}
