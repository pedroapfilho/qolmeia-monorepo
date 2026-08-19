import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendEmail, type EmailClientFactory } from "./send-email";

const sendMock = vi.fn();
const createClient: EmailClientFactory = () => ({
  batch: { send: vi.fn() },
  emails: { send: sendMock },
});

describe("sendEmail from validation", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "test" }, error: null });
  });

  const template = createElement("div", null, "hi");

  it('accepts "Display Name <email>" form in from', async () => {
    const result = await sendEmail(
      {
        apiKey: "re_test",
        from: "Qolmeia <noreply@email.qolmeia.com>",
        subject: "x",
        template,
        to: "delivered+test@resend.dev",
      },
      createClient,
    );

    expect(result.success).toBe(true);
    expect(sendMock).toHaveBeenCalledOnce();
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      from: "Qolmeia <noreply@email.qolmeia.com>",
    });
  });

  it("accepts bare email in from", async () => {
    const result = await sendEmail(
      {
        apiKey: "re_test",
        from: "noreply@email.qolmeia.com",
        subject: "x",
        template,
        to: "delivered+test@resend.dev",
      },
      createClient,
    );

    expect(result.success).toBe(true);
  });

  it("falls back to default wrapped sender when from is omitted", async () => {
    const result = await sendEmail(
      {
        apiKey: "re_test",
        subject: "x",
        template,
        to: "delivered+test@resend.dev",
      },
      createClient,
    );

    expect(result.success).toBe(true);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      from: "Qolmeia <noreply@email.qolmeia.com>",
    });
  });

  it("rejects from values that are neither bare email nor wrapped form", async () => {
    const result = await sendEmail(
      {
        apiKey: "re_test",
        from: "not-an-email",
        subject: "x",
        template,
        to: "delivered+test@resend.dev",
      },
      createClient,
    );

    expect(result.success).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
