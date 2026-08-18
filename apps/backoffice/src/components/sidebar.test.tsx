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
    expect(screen.getByRole("link", { name: /Início/v })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Aprovações/v })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tickets/v })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Modelos/v })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Atividade/v })).toBeInTheDocument();
  });

  it("marks the active route with aria-current", () => {
    render(<Sidebar />);
    const active = screen.getByRole("link", { name: /Aprovações/v });
    expect(active.getAttribute("aria-current")).toBe("page");
  });

  it("renders the sign-out control in the footer", () => {
    render(<Sidebar />);
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });
});
