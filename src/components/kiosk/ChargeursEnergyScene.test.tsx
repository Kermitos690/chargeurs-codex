import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChargeursEnergyScene } from "./ChargeursEnergyScene";

describe("ChargeursEnergyScene canonical safety contract", () => {
  it("does not depict a released battery while hardware release is only waiting", () => {
    render(<ChargeursEnergyScene sceneCue="RELEASE_WAIT" renderTier="SAFE" slotNumber={2} />);
    const scene = screen.getByRole("region", { name: /libération en attente/i });
    expect(scene).toHaveAttribute("data-scene-cue", "RELEASE_WAIT");
    expect(scene).not.toHaveAccessibleName(/batterie libérée/i);
  });

  it("keeps return guidance distinct from accepted physical return", () => {
    const { rerender } = render(<ChargeursEnergyScene sceneCue="RETURN_GUIDANCE" renderTier="SAFE" slotNumber={3} />);
    expect(screen.getByRole("region", { name: /insérez la batterie/i })).toHaveAttribute("data-scene-cue", "RETURN_GUIDANCE");
    expect(screen.queryByRole("region", { name: /retour accepté/i })).not.toBeInTheDocument();

    rerender(<ChargeursEnergyScene sceneCue="RETURN_ACCEPTED" renderTier="SAFE" slotNumber={3} />);
    expect(screen.getByRole("region", { name: /retour accepté/i })).toHaveAttribute("data-scene-cue", "RETURN_ACCEPTED");
  });

  it("preserves HIGH / MEDIUM / SAFE as presentation-only renderer tiers", () => {
    const { rerender } = render(<ChargeursEnergyScene sceneCue="PAYMENT_READY" renderTier="SAFE" />);
    expect(screen.getByRole("region", { name: /paiement prêt/i })).toHaveAttribute("data-render-tier", "SAFE");

    rerender(<ChargeursEnergyScene sceneCue="PAYMENT_READY" renderTier="MEDIUM" />);
    expect(screen.getByRole("region", { name: /paiement prêt/i })).toHaveAttribute("data-render-tier", "MEDIUM");
  });
});
