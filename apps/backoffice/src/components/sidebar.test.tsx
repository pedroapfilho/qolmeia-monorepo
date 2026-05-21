import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/approvals",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signOut: vi.fn(() => Promise.resolve({ data: { success: true }, error: null })),
  },
}));

vi.mock("@repo/ui/components/sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@repo/ui/components/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    // eslint-disable-next-line react/button-has-type -- pass-through stub for testing
    <button type="button" {...props} />
  ),
}));

const { Sidebar } = await import("./sidebar");

describe("Sidebar", () => {
  it("renders every nav link in pt-BR", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Início/v })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Aprovações/v })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Atividade/v })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Agentes/v })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Soul/v })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Execuções/v })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Equipe/v })).toBeInTheDocument();
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
