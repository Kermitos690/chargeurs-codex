package ch.chargeurs.kiosk;

import org.json.JSONObject;

public interface HardwareTransport {
    boolean isReady();
    JSONObject status();
    byte[] transact(byte[] request, int timeoutMs) throws Exception;
}

