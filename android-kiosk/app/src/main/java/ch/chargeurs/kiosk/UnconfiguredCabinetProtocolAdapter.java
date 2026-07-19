package ch.chargeurs.kiosk;

public final class UnconfiguredCabinetProtocolAdapter implements CabinetProtocolAdapter {
    @Override
    public String protocolName() {
        return "NOT_CONFIGURED";
    }

    @Override
    public boolean isConfigured() {
        return false;
    }

    @Override
    public byte[] createEjectRequest(int slot, String commandId) {
        throw new IllegalStateException("CABINET_PROTOCOL_NOT_CONFIGURED");
    }

    @Override
    public boolean isSuccessfulEjectResponse(byte[] response, int slot, String commandId) {
        return false;
    }
}

