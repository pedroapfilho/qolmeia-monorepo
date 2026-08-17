import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@repo/app-shell/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn(() => Promise.resolve({ data: null, error: null })) },
  },
}));

vi.mock("@repo/ui/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@repo/ui/components/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    // eslint-disable-next-line react/button-has-type -- pass-through stub for testing
    <button type="button" {...props} />
  ),
}));

const { default: LoginPage } = await import("./page");

describe("LoginPage", () => {
  it("renders the e-mail and password inputs", () => {
    render(<LoginPage searchParams={Promise.resolve({})} />);
    expect(screen.getByLabelText(/E-mail/v)).toBeInTheDocument();
    expect(screen.getByLabelText("Senha")).toBeInTheDocument();
  });

  it("shows the primary CTA and the secondary links", () => {
    render(<LoginPage searchParams={Promise.resolve({})} />);
    expect(screen.getByRole("button", { name: /Entrar/v })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Esqueci minha senha" })).toHaveAttribute(
      "href",
      "/recover",
    );
    expect(screen.getByRole("link", { name: "Criar conta" })).toHaveAttribute("href", "/register");
  });
});
