import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOutMock = vi.fn(() => Promise.resolve({ data: { success: true }, error: null }));
const pushMock = vi.fn();
const refreshMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signOut: signOutMock,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@repo/ui/components/sonner", () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
}));

// Stub Base-UI Button — its render path needs DOM features jsdom doesn't
// model. The component under test only relies on onClick / disabled, so
// a plain <button> covers the contract.
vi.mock("@repo/ui/components/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    // eslint-disable-next-line react/button-has-type -- pass-through stub for testing
    <button type="button" {...props} />
  ),
}));

const { SignOutButton } = await import("./sign-out-button");

describe("SignOutButton", () => {
  beforeEach(() => {
    signOutMock.mockClear();
    pushMock.mockClear();
    refreshMock.mockClear();
    toastErrorMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the default label", () => {
    render(<SignOutButton />);
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it("renders a custom label", () => {
    render(<SignOutButton label="Encerrar sessão" />);
    expect(screen.getByRole("button", { name: "Encerrar sessão" })).toBeInTheDocument();
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
    // Silence the console.error the component emits on failure paths.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));

    await vi.waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
    });

    errorSpy.mockRestore();
  });
});
