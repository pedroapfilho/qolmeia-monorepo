import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeEmail } from "../emails/change-email";
import { MagicLinkEmail } from "../emails/magic-link";
import { PasswordResetEmail } from "../emails/password-reset";
import { SignUpAttemptEmail } from "../emails/sign-up-attempt";
import { WelcomeEmail } from "../emails/welcome";

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

const { previewEmail } = await import("./send-email");
const { sendTransactionalEmail } = await import("./senders");

describe("WelcomeEmail render", () => {
  it("includes the verification URL and Qolmeia branding", async () => {
    const { html, text } = await previewEmail(
      React.createElement(WelcomeEmail, {
        userEmail: "user@example.com",
        username: "Pedro",
        verificationUrl: "https://app.qolmeia.ai/verify?token=abc",
      }),
    );
    expect(html).toContain("https://app.qolmeia.ai/verify?token=abc");
    expect(html).toContain("Welcome to Qolmeia");
    expect(text).toMatch(/welcome to qolmeia/iv);
    expect(html).not.toContain("Acme");
  });
});

describe("PasswordResetEmail render", () => {
  it("includes the reset URL and Qolmeia branding", async () => {
    const { html } = await previewEmail(
      React.createElement(PasswordResetEmail, {
        resetUrl: "https://app.qolmeia.ai/reset?token=xyz",
        userEmail: "user@example.com",
      }),
    );
    expect(html).toContain("https://app.qolmeia.ai/reset?token=xyz");
    expect(html).toContain("Reset your password");
    expect(html).not.toContain("Acme");
  });
});

describe("SignUpAttemptEmail render", () => {
  it("includes both sign-in and reset URLs", async () => {
    const { html } = await previewEmail(
      React.createElement(SignUpAttemptEmail, {
        resetPasswordUrl: "https://app.qolmeia.ai/recover",
        signInUrl: "https://app.qolmeia.ai/login",
        userEmail: "user@example.com",
      }),
    );
    expect(html).toContain("https://app.qolmeia.ai/login");
    expect(html).toContain("https://app.qolmeia.ai/recover");
    expect(html).toContain("Qolmeia");
  });
});

describe("ChangeEmail render", () => {
  it("renders both current and new emails", async () => {
    const { html } = await previewEmail(
      React.createElement(ChangeEmail, {
        changeUrl: "https://app.qolmeia.ai/change?token=abc",
        currentEmail: "old@example.com",
        newEmail: "new@example.com",
      }),
    );
    expect(html).toContain("old@example.com");
    expect(html).toContain("new@example.com");
    expect(html).toContain("https://app.qolmeia.ai/change?token=abc");
  });
});

describe("MagicLinkEmail render", () => {
  it("includes the magic link URL and pt-BR copy", async () => {
    const { html, text } = await previewEmail(
      React.createElement(MagicLinkEmail, {
        url: "https://app.qolmeia.ai/auth/magic?token=mlk-123",
        userEmail: "user@example.com",
        username: "Pedro",
      }),
    );
    expect(html).toContain("https://app.qolmeia.ai/auth/magic?token=mlk-123");
    expect(html).toContain("Entre na Qolmeia");
    expect(text).toMatch(/entre na qolmeia/iv);
    expect(html).toContain("user@example.com");
  });

  it("renders without a username", async () => {
    const { html, text } = await previewEmail(
      React.createElement(MagicLinkEmail, {
        url: "https://app.qolmeia.ai/auth/magic?token=mlk-456",
        userEmail: "user@example.com",
      }),
    );
    expect(html).toContain("https://app.qolmeia.ai/auth/magic?token=mlk-456");
    expect(text).toContain("Olá,");
  });
});

describe("sendTransactionalEmail", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "test" }, error: null });
  });

  it("routes a welcome payload to the user with type and userId tags", async () => {
    const result = await sendTransactionalEmail(
      {
        type: "welcome",
        userEmail: "user@example.com",
        userId: "user_1",
        username: "Pedro",
        verificationUrl: "https://app.qolmeia.ai/verify?token=abc",
      },
      { apiKey: "re_test" },
    );

    expect(result.success).toBe(true);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      from: "Qolmeia <noreply@qolmeia.ai>",
      subject: "Welcome to Qolmeia, Pedro! Please verify your email",
      tags: [
        { name: "type", value: "welcome" },
        { name: "userId", value: "user_1" },
      ],
      to: "user@example.com",
    });
  });

  it("sends a magic-link email without a userId tag when the account does not exist yet", async () => {
    const result = await sendTransactionalEmail(
      {
        type: "magic-link",
        url: "https://app.qolmeia.ai/auth/magic?token=mlk-123",
        userEmail: "user@example.com",
      },
      { apiKey: "re_test", from: "noreply@qolmeia.ai" },
    );

    expect(result.success).toBe(true);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      from: "noreply@qolmeia.ai",
      subject: "Seu link de acesso à Qolmeia",
      tags: [{ name: "type", value: "magic-link" }],
      to: "user@example.com",
    });
    expect(sendMock.mock.calls[0][0].html).toContain(
      "https://app.qolmeia.ai/auth/magic?token=mlk-123",
    );
  });

  it("sends the change-email confirmation to the current address", async () => {
    const result = await sendTransactionalEmail(
      {
        changeUrl: "https://app.qolmeia.ai/change?token=abc",
        currentEmail: "old@example.com",
        newEmail: "new@example.com",
        type: "change-email-confirmation",
        userId: "user_1",
      },
      { apiKey: "re_test" },
    );

    expect(result.success).toBe(true);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      subject: "Confirm change of your Qolmeia account email",
      to: "old@example.com",
    });
  });
});
