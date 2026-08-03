import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { PUBLIC_STATION_FIELDS, publicStationPath, stationDirectionsUrl } from "./publicStationData";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({ select: mocks.select })),
  },
}));

vi.mock("@/components/LiquidBackground", () => ({ LiquidBackground: () => null }));
vi.mock("@/components/public/PublicNav", () => ({ PublicNav: () => <nav>Navigation publique</nav> }));

import PublicStation from "./PublicStation";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function prepareQuery(result: { data: unknown; error: unknown }) {
  mocks.maybeSingle.mockResolvedValue(result);
  mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
  mocks.select.mockReturnValue({ eq: mocks.eq });
}

async function renderStation() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={["/bornes/DTA21269"]}>
        <Routes><Route path="/bornes/:stationId" element={<PublicStation />} /></Routes>
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

function linkContaining(label: string) {
  return Array.from(document.querySelectorAll("a")).find((link) => link.textContent?.includes(label));
}

describe("public station page", () => {
  it("uses the public route instead of exposing the kiosk route", () => {
    expect(publicStationPath(" dta21269 ")).toBe("/bornes/DTA21269");
    expect(publicStationPath("DTA21269")).not.toContain("/kiosk");
  });

  it("queries only the public allow-list and shows real availability", async () => {
    prepareQuery({
      data: {
        station_id: "DTA21269",
        name: "Chargeurs.ch — Borne pilote",
        location_name: "Lausanne Gare",
        status: "online",
        online: true,
        rentable_count: 3,
        returnable_count: 2,
        total_count: 6,
        currency: "CHF",
        price_per_period: 0.75,
        last_sync_at: "2026-07-31T12:00:00Z",
      },
      error: null,
    });

    await renderStation();

    await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("Chargeurs.ch — Borne pilote"));
    expect(document.body.textContent).toContain("Batteries disponibles");
    expect(document.body.textContent).toContain("Lausanne Gare");
    expect(linkContaining("Itinéraire")?.getAttribute("href")).toBe(stationDirectionsUrl("Lausanne Gare", "DTA21269"));
    expect(linkContaining("Besoin d'aide")?.getAttribute("href")).toBe("/support?station=DTA21269");
    expect(mocks.select).toHaveBeenCalledWith(PUBLIC_STATION_FIELDS);
    expect(PUBLIC_STATION_FIELDS).not.toContain("raw_data");
    expect(PUBLIC_STATION_FIELDS).not.toContain("cabinet_id");
  });

  it("shows an explicit error without fallback data", async () => {
    prepareQuery({ data: null, error: { message: "network" } });
    await renderStation();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("Aucune donnée de démonstration"));
    expect(document.body.textContent).not.toContain("Batteries disponibles");
  });

  it("normalizes the station id before querying", async () => {
    prepareQuery({ data: null, error: null });
    await renderStation();
    await vi.waitFor(() => expect(mocks.eq).toHaveBeenCalledWith("station_id", "DTA21269"));
  });
});
