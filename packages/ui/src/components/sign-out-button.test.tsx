import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSignOutButton } from "./sign-out-button";

const signOutMock = vi.fn(() => Promise.resolve());
const pushMock = vi.fn();
const refreshMock = vi.fn();
const toastErrorMock = vi.fn();

const SignOutButton = createSignOutButton({
  showError: (message) => {
    toastErrorMock(message);
  },
  signOut: signOutMock,
  useAppRouter: () => ({
    push: (path) => {
      pushMock(path);
    },
    refresh: () => {
      refreshMock();
    },
  }),
});

describe("SignOutButton", () => {
  beforeEach(() => {
    signOutMock.mockClear();
    pushMock.mockClear();
    refreshMock.mockClear();
    toastErrorMock.mockClear();
  });

  it("renders the default label", () => {
    render(<SignOutButton />);
    expect(screen.getByRole("button", { name: "Sair" })).toBeTruthy();
  });

  it("renders a custom label", () => {
    render(<SignOutButton label="Encerrar sessão" />);
    expect(screen.getByRole("button", { name: "Encerrar sessão" })).toBeTruthy();
  });

  it("calls authClient.signOut and redirects to /login on click", async () => {
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));

    await vi.waitFor(() => {
      expect(signOutMock).toHaveBeenCalledOnce();
      expect(pushMock).toHaveBeenCalledWith("/login");
    });
  });

  it("shows an error toast when signOut throws", async () => {
    signOutMock.mockRejectedValueOnce(new Error("boom"));

    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));

    await vi.waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
