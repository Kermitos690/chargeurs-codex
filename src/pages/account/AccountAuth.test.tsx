import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: auth,
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  },
  passwordRecoveryAuth: { auth },
}));
vi.mock("@/integrations/lovable/index", () => ({ lovable: { auth: { signInWithOAuth: vi.fn() } } }));
vi.mock("@/components/LiquidBackground", () => ({ LiquidBackground: () => null }));
vi.mock("@/components/BrandLogo", () => ({ BrandLogo: () => <span>Chargeurs.ch</span> }));
vi.mock("@/lib/roles", () => ({ canView: () => false }));

import AccountAuth from "./AccountAuth";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function change(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<MemoryRouter><AccountAuth /></MemoryRouter>));
  return container;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("customer signup", () => {
  it("requires legal acceptance and shows a non-enumerating confirmation message before opening the private account", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const container = mount();

    click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Créer un compte")!);
    const email = container.querySelector('input[type="email"]') as HTMLInputElement;
    const password = container.querySelector('input[type="password"]') as HTMLInputElement;
    const checkbox = container.querySelector('button[role="checkbox"]')!;
    change(email, "client@example.test");
    change(password, "un-mot-de-passe-solide");
    click(checkbox);
    click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Créer le compte")!);

    await act(async () => { await Promise.resolve(); });
    expect(auth.signUp).toHaveBeenCalledTimes(1);
    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: "client@example.test",
      options: expect.objectContaining({
        data: expect.objectContaining({ display_name: "" }),
      }),
    }));
    expect(document.body.textContent).toContain("Vérifiez votre adresse email");
    expect(document.body.textContent).toContain("client@example.test");
    expect(document.body.textContent).toContain("Si un compte existe déjà");
  });

  it("does not advertise Google sign-in until it is configured", () => {
    const container = mount();
    expect(container.textContent).not.toContain("Continuer avec Google");
  });
});
