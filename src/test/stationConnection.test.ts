import { describe, expect, it } from "vitest";
import { stationConnectionLabel, stationConnectionState } from "@/lib/stationConnection";

describe("stationConnectionState", () => {
  it("keeps a confirmed provider-online station online", () => {
    expect(stationConnectionState({ status: "online", online: true })).toBe("online");
  });

  it("shows an explicit provider offline response as offline", () => {
    expect(stationConnectionState({ status: "offline", online: false })).toBe("offline");
  });

  it("does not present an ambiguous provider poll as a physical outage", () => {
    const input = { status: "unknown", online: false };
    expect(stationConnectionState(input)).toBe("unknown");
    expect(stationConnectionLabel(input)).toBe("Statut à vérifier");
  });
});
