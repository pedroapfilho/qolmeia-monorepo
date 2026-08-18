import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createLoginPage } from "./page";

const showError = vi.fn();
const push = vi.fn();
const refresh = vi.fn();
const LoginPage = createLoginPage({
  showError: (message) => {
    showError(message);
  },
  signInEmail: vi.fn(() => Promise.resolve({ error: null })),
  useAppRouter: () => ({
    push: (path) => {
      push(path);
    },
    refresh: () => {
      refresh();
    },
  }),
});

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
