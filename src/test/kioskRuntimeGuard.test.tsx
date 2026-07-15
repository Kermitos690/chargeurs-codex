import { afterEach, describe, expect, it } from "vitest";
import { currentKioskStation, hasMeaningfulKioskContent } from "@/components/kiosk/KioskRuntimeGuard";

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("kiosk runtime recovery guard", () => {
  it("extracts the cabinet from a direct kiosk route", () => {
    window.history.replaceState({}, "", "/kiosk/DTA21269");
    expect(currentKioskStation()).toBe("DTA21269");
  });

  it("detects a blank kiosk main area", () => {
    document.body.innerHTML = '<main class="kiosk"></main>';
    expect(hasMeaningfulKioskContent()).toBe(false);
  });

  it("accepts loading, error or normal content as meaningful", () => {
    document.body.innerHTML = '<main class="kiosk"><p>Chargement…</p></main>';
    expect(hasMeaningfulKioskContent()).toBe(true);

    document.body.innerHTML = '<main class="kiosk"><p>Borne temporairement indisponible</p></main>';
    expect(hasMeaningfulKioskContent()).toBe(true);
  });
});
