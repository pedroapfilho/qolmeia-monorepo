import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiSend = vi.fn();
const toastError = vi.fn();

beforeEach(() => {
  apiSend.mockReset();
  toastError.mockReset();
});

vi.mock("@/lib/api-client", () => ({
  apiSend: (...args: ReadonlyArray<unknown>) => apiSend(...args),
}));

vi.mock("@repo/ui/components/sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));

vi.mock("@repo/ui/components/button", () => ({
  Button: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    // eslint-disable-next-line react/button-has-type -- pass-through stub for testing
    <button type="button" {...rest}>
      {children}
    </button>
  ),
}));

const { Composer } = await import("./composer");

describe("Composer", () => {
  it("disables submit while the textarea is empty", () => {
    render(<Composer conversationId={null} onSent={vi.fn()} />);
    const submit = screen.getByRole("button", { name: "Enviar" });
    expect(submit).toBeDisabled();
  });

  it("posts on submit + clears the textarea on success", async () => {
    apiSend.mockResolvedValueOnce({
      conversationId: "conv_new",
      messageExternalId: "ext_1",
    });
    const onSent = vi.fn();
    render(<Composer conversationId={null} onSent={onSent} />);

    const textarea = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "oi" } });

    const submit = screen.getByRole("button", { name: "Enviar" });
    fireEvent.click(submit);

    await waitFor(() => expect(apiSend).toHaveBeenCalledOnce());
    expect(apiSend.mock.calls[0]).toMatchObject([
      "POST",
      "/web-chat/messages",
      { text: "oi" },
    ]);
    await waitFor(() => expect(onSent).toHaveBeenCalledOnce());
    expect(onSent.mock.calls[0]![0]).toMatchObject({ conversationId: "conv_new" });
  });

  it("includes conversationId in the body when one is supplied", async () => {
    apiSend.mockResolvedValueOnce({ conversationId: "conv_existing", messageExternalId: "ext_2" });
    render(<Composer conversationId="conv_existing" onSent={vi.fn()} />);

    const textarea = screen.getByLabelText("Mensagem");
    fireEvent.change(textarea, { target: { value: "de novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(apiSend).toHaveBeenCalledOnce());
    expect(apiSend.mock.calls[0]![2]).toMatchObject({
      conversationId: "conv_existing",
      text: "de novo",
    });
  });
});
