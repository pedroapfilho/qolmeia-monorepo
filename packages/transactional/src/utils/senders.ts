import * as React from "react";

import { ChangeEmail } from "../emails/change-email";
import { MagicLinkEmail } from "../emails/magic-link";
import { PasswordResetEmail } from "../emails/password-reset";
import { SignUpAttemptEmail } from "../emails/sign-up-attempt";
import { WelcomeEmail } from "../emails/welcome";

import { sendEmail } from "./send-email";

type EmailConfig = {
  apiKey: string;
  defaultReplyTo?: string;
  from?: string;
};

const DEFAULT_FROM = "Qolmeia <noreply@qolmeia.ai>";

const sendWelcomeEmail = (
  {
    userEmail,
    userId,
    username,
    verificationUrl,
  }: {
    userEmail: string;
    userId: string;
    username?: string;
    verificationUrl: string;
  },
  config: EmailConfig,
) => {
  return sendEmail({
    apiKey: config.apiKey,
    defaultReplyTo: config.defaultReplyTo,
    from: config.from || DEFAULT_FROM,
    subject: `Welcome to Qolmeia${username ? `, ${username}` : ""}! Please verify your email`,
    tags: [
      { name: "type", value: "welcome" },
      { name: "userId", value: userId },
    ],
    template: React.createElement(WelcomeEmail, {
      userEmail,
      username,
      verificationUrl,
    }),
    to: userEmail,
  });
};

const sendSignUpAttemptEmail = (
  {
    resetPasswordUrl,
    signInUrl,
    userEmail,
    userId,
    username,
  }: {
    resetPasswordUrl: string;
    signInUrl: string;
    userEmail: string;
    userId: string;
    username?: string;
  },
  config: EmailConfig,
) => {
  return sendEmail({
    apiKey: config.apiKey,
    defaultReplyTo: config.defaultReplyTo,
    from: config.from || DEFAULT_FROM,
    subject: "Sign-up attempt with your Qolmeia account",
    tags: [
      { name: "type", value: "sign-up-attempt" },
      { name: "userId", value: userId },
    ],
    template: React.createElement(SignUpAttemptEmail, {
      resetPasswordUrl,
      signInUrl,
      userEmail,
      username,
    }),
    to: userEmail,
  });
};

const sendPasswordResetEmail = (
  {
    browserInfo,
    ipAddress,
    resetUrl,
    userEmail,
    userId,
    username,
  }: {
    browserInfo?: string;
    ipAddress?: string;
    resetUrl: string;
    userEmail: string;
    userId: string;
    username?: string;
  },
  config: EmailConfig,
) => {
  return sendEmail({
    apiKey: config.apiKey,
    defaultReplyTo: config.defaultReplyTo,
    from: config.from || DEFAULT_FROM,
    subject: "Reset your Qolmeia password",
    tags: [
      { name: "type", value: "password-reset" },
      { name: "userId", value: userId },
    ],
    template: React.createElement(PasswordResetEmail, {
      browserInfo,
      ipAddress,
      resetUrl,
      userEmail,
      username,
    }),
    to: userEmail,
  });
};

const sendChangeEmailConfirmation = (
  {
    changeUrl,
    currentEmail,
    newEmail,
    userId,
    username,
  }: {
    changeUrl: string;
    currentEmail: string;
    newEmail: string;
    userId: string;
    username?: string;
  },
  config: EmailConfig,
) => {
  return sendEmail({
    apiKey: config.apiKey,
    defaultReplyTo: config.defaultReplyTo,
    from: config.from || DEFAULT_FROM,
    subject: "Confirm change of your Qolmeia account email",
    tags: [
      { name: "type", value: "change-email-confirmation" },
      { name: "userId", value: userId },
    ],
    template: React.createElement(ChangeEmail, {
      changeUrl,
      currentEmail,
      newEmail,
      username,
    }),
    to: currentEmail,
  });
};

const sendMagicLinkEmail = (
  {
    url,
    userEmail,
    userId,
    username,
  }: {
    url: string;
    userEmail: string;
    userId?: string;
    username?: string;
  },
  config: EmailConfig,
) => {
  return sendEmail({
    apiKey: config.apiKey,
    defaultReplyTo: config.defaultReplyTo,
    from: config.from || DEFAULT_FROM,
    subject: "Seu link de acesso à Qolmeia",
    tags: [
      { name: "type", value: "magic-link" },
      ...(userId ? [{ name: "userId", value: userId }] : []),
    ],
    template: React.createElement(MagicLinkEmail, {
      url,
      userEmail,
      username,
    }),
    to: userEmail,
  });
};

export {
  sendChangeEmailConfirmation,
  sendMagicLinkEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendSignUpAttemptEmail,
};
