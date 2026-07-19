package ch.chargeurs.kiosk;

public interface CabinetProtocolAdapter {
    String protocolName();
    boolean isConfigured();
    byte[] createEjectRequest(int slot, String commandId) throws Exception;
    boolean isSuccessfulEjectResponse(byte[] response, int slot, String commandId) throws Exception;
}

