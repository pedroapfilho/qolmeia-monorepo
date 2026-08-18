import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createLoginForm } from "./login-form";

const showError = vi.fn();
const LoginForm = createLoginForm({
  sendMagicLink: vi.fn(() => Promise.resolve({ error: null })),
  showError: (message) => {
    showError(message);
  },
});

describe("LoginForm", () => {
  it("renders the e-mail input + magic-link CTA", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText(/E-mail/v)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar link/v })).toBeInTheDocument();
  });

  it("does not show a password field (magic-link only)", () => {
    render(<LoginForm />);
    expect(screen.queryByLabelText(/Senha/v)).not.toBeInTheDocument();
  });
});
