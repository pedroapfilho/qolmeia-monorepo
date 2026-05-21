import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sair</button>,
}));

vi.mock("@repo/ui/lib/utils", () => ({
  cn: (...args: ReadonlyArray<unknown>) => args.filter(Boolean).join(" "),
}));

const { Nav } = await import("./nav");

describe("Nav", () => {
  it("renders the three top-level customer links", () => {
    render(<Nav orgName="Salão" />);
    expect(screen.getByRole("link", { name: /Chat/v })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /Assets/v })).toHaveAttribute("href", "/assets");
    expect(screen.getByRole("link", { name: /Atividade/v })).toHaveAttribute("href", "/activity");
  });

  it("renders the supplied org name in the brand slot", () => {
    render(<Nav orgName="Salão da Maria" />);
    expect(screen.getByRole("link", { name: "Salão da Maria" })).toBeInTheDocument();
  });

  it("falls back to 'Qolmeia' when the org name is null", () => {
    render(<Nav orgName={null} />);
    expect(screen.getByRole("link", { name: "Qolmeia" })).toBeInTheDocument();
  });

  it("marks the active route with aria-current=page", () => {
    render(<Nav orgName="Salão" />);
    expect(screen.getByRole("link", { name: /Chat/v })).toHaveAttribute("aria-current", "page");
  });
});
