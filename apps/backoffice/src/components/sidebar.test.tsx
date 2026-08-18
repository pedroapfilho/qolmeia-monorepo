import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createSidebar } from "./sidebar";

const Sidebar = createSidebar({
  SignOutControl: ({ className }) => (
    <button className={className} type="button">
      Sair
    </button>
  ),
  useCurrentPathname: () => "/approvals",
});

describe("Sidebar", () => {
  it("renders every nav link in pt-BR", () => {
    render(<Sidebar />);
    expect(screen.getAllByRole("link", { name: /Início/v })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Aprovações/v })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Tickets/v })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Modelos/v })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Atividade/v })).toHaveLength(2);
  });

  it("marks the active route with aria-current", () => {
    render(<Sidebar />);
    const activeLinks = screen.getAllByRole("link", { name: /Aprovações/v });
    expect(activeLinks).toHaveLength(2);
    expect(activeLinks.every((link) => link.getAttribute("aria-current") === "page")).toBe(true);
  });

  it("renders the sign-out control in the footer", () => {
    render(<Sidebar />);
    expect(screen.getAllByRole("button", { name: "Sair" })).toHaveLength(2);
  });
});
