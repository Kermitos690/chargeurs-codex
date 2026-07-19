package ch.chargeurs.kiosk;

public final class EjectionAuthorization {
    private final String commandId;
    private final String nonce;
    private final String rentalSessionId;
    private final int slot;
    private final long expiresAtSeconds;

    public EjectionAuthorization(String commandId, String nonce, String rentalSessionId, int slot, long expiresAtSeconds) {
        this.commandId = commandId;
        this.nonce = nonce;
        this.rentalSessionId = rentalSessionId;
        this.slot = slot;
        this.expiresAtSeconds = expiresAtSeconds;
    }

    public String commandId() { return commandId; }
    public String nonce() { return nonce; }
    public String rentalSessionId() { return rentalSessionId; }
    public int slot() { return slot; }
    public long expiresAtSeconds() { return expiresAtSeconds; }
}
