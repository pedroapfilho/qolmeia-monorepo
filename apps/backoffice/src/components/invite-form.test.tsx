import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiSend = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

vi.mock("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, body: string) {
      super(body);
      this.status = status;
    }
  },
  apiSend: (...args: ReadonlyArray<unknown>) => apiSend(...args),
}));

vi.mock("@repo/ui/components/sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));

vi.mock("@repo/ui/components/button", () => ({
  Button: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    // eslint-disable-next-line react/button-has-type -- pass-through stub for testing
    <button type="button" {...rest}>
      {children}
    </button>
  ),
}));

beforeEach(() => {
  apiSend.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  refresh.mockReset();
});

const { InviteForm } = await import("./invite-form");

describe("InviteForm", () => {
  it("renders the name, email, and role inputs", () => {
    render(<InviteForm onClose={vi.fn()} />);
    expect(screen.getByLabelText(/Nome/v)).toBeInTheDocument();
    expect(screen.getByLabelText(/E-mail/v)).toBeInTheDocument();
    expect(screen.getByLabelText(/Papel/v)).toBeInTheDocument();
  });

  it("posts to /team/invite with the form values + selected role", async () => {
    apiSend.mockResolvedValueOnce({ member: { id: "u_new" } });
    const onClose = vi.fn();
    render(<InviteForm onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/Nome/v), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText(/E-mail/v), {
      target: { value: "maria@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Papel/v), { target: { value: "STAFF" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar convite/v }));

    await waitFor(() => expect(apiSend).toHaveBeenCalledOnce());
    expect(apiSend.mock.calls[0]).toMatchObject([
      "POST",
      "/team/invite",
      { email: "maria@example.com", name: "Maria", role: "STAFF" },
    ]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("shows an error toast on API failure", async () => {
    apiSend.mockRejectedValueOnce(new Error("network down"));
    render(<InviteForm onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Nome/v), { target: { value: "João" } });
    fireEvent.change(screen.getByLabelText(/E-mail/v), { target: { value: "j@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar convite/v }));

    await waitFor(() => expect(apiSend).toHaveBeenCalledOnce());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
