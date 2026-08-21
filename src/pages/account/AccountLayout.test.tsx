import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ACCOUNT_NAV_ITEMS } from "./accountNavigation";

const authMocks = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("@/hooks/useCustomer", () => ({
  useCustomer: () => ({ user: { id: "customer-1", email: "client@example.test" }, loading: false }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: false, loading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: authMocks.signOut } },
}));
vi.mock("@/components/LiquidBackground", () => ({ LiquidBackground: () => null }));
vi.mock("@/components/BrandLogo", () => ({ BrandLogo: () => <span>Chargeurs.ch</span> }));

import AccountLayout from "./AccountLayout";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("customer account navigation", () => {
  it("exposes the five real customer sections on desktop and mobile", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(
      <MemoryRouter initialEntries={["/compte"]}>
        <Routes>
          <Route path="/compte" element={<AccountLayout />}>
            <Route index element={<p>Accueil client</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    ));

    expect(document.body.textContent).toContain("Accueil client");
    expect(document.querySelectorAll('nav[aria-label="Navigation du compte"]')).toHaveLength(2);
    for (const item of ACCOUNT_NAV_ITEMS) {
      const links = Array.from(document.querySelectorAll("a")).filter((link) => link.textContent?.trim() === item.label);
      expect(links).toHaveLength(2);
      expect(links.every((link) => link.getAttribute("href") === item.to)).toBe(true);
    }
  });

  it("keeps kiosk routes out of the customer navigation", () => {
    expect(ACCOUNT_NAV_ITEMS.map((item) => item.to)).toEqual([
      "/compte",
      "/compte/locations",
      "/compte/paiements",
      "/compte/pass",
      "/compte/support",
      "/compte/profil",
    ]);
    expect(ACCOUNT_NAV_ITEMS.some((item) => item.to.startsWith("/kiosk"))).toBe(false);
  });
});
