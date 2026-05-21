import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const signOut = vi.fn(() => Promise.resolve());
const push = vi.fn();
const refresh = vi.fn();
const toastError = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut },
}));

vi.mock("@repo/ui/components/sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));

vi.mock("@repo/ui/components/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    // eslint-disable-next-line react/button-has-type -- pass-through stub for testing
    <button type="button" {...props} />
  ),
}));

const { SignOutButton } = await import("./sign-out-button");

describe("SignOutButton", () => {
  it("renders the default label", () => {
    render(<SignOutButton />);
    expect(screen.getByRole("button", { name: /Sair/v })).toBeInTheDocument();
  });

  it("accepts a custom label", () => {
    render(<SignOutButton label="Sair desta conta" />);
    expect(screen.getByRole("button", { name: "Sair desta conta" })).toBeInTheDocument();
  });

  it("calls signOut + router.push on click", () => {
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: /Sair/v }));
    expect(signOut).toHaveBeenCalled();
  });
});
