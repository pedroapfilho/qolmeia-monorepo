import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createLoginForm } from "./login-form";

const renderLoginForm = () => {
  const push = vi.fn();
  const refresh = vi.fn();
  const sendMagicLink = vi.fn(() => Promise.resolve({ error: null }));
  const showError = vi.fn();
  const signInEmail = vi.fn(() => Promise.resolve({ error: null }));
  const LoginForm = createLoginForm({
    sendMagicLink,
    showError: (message) => {
      showError(message);
    },
    signInEmail,
    useAppRouter: () => ({
      push: (href) => {
        push(href);
      },
      refresh: () => {
        refresh();
      },
    }),
  });

  render(<LoginForm />);

  return { push, refresh, sendMagicLink, showError, signInEmail };
};

describe("LoginForm", () => {
  it("renders password and magic-link login options", () => {
    renderLoginForm();
    expect(screen.getByLabelText(/E-mail/v)).toBeInTheDocument();
    expect(screen.getByLabelText(/Senha/v)).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByText("OU")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar link/v })).toBeInTheDocument();
  });

  it("signs in with e-mail and password", async () => {
    const { push, refresh, signInEmail } = renderLoginForm();

    fireEvent.change(screen.getByLabelText(/E-mail/v), {
      target: { value: "pedro+customer@filho.me" },
    });
    fireEvent.change(screen.getByLabelText(/Senha/v), {
      target: { value: "Senha123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => {
      expect(signInEmail).toHaveBeenCalledWith({
        email: "pedro+customer@filho.me",
        password: "Senha123!",
      });
    });
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps magic-link login available", async () => {
    const { sendMagicLink } = renderLoginForm();

    fireEvent.change(screen.getByLabelText(/E-mail/v), {
      target: { value: "pedro+customer@filho.me" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Enviar link/v }));

    await waitFor(() => {
      expect(sendMagicLink).toHaveBeenCalledWith({
        callbackURL: "http://localhost:3000/auth/verify",
        email: "pedro+customer@filho.me",
      });
    });
    expect(screen.getByRole("heading", { name: "Verifique seu e-mail" })).toBeInTheDocument();
  });
});
