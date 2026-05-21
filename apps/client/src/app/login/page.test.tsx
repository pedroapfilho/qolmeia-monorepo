import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { magicLink: vi.fn(() => Promise.resolve({ data: null, error: null })) },
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

const { default: LoginPage } = await import("./page");

describe("LoginPage", () => {
  it("renders the e-mail input + magic-link CTA", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/E-mail/v)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar link/v })).toBeInTheDocument();
  });

  it("does not show a password field (magic-link only)", () => {
    render(<LoginPage />);
    expect(screen.queryByLabelText(/Senha/v)).not.toBeInTheDocument();
  });
});
