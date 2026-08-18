import * as React from "react";

import { ChangeEmail } from "../emails/change-email";
import { MagicLinkEmail } from "../emails/magic-link";
import { PasswordResetEmail } from "../emails/password-reset";
import { SignUpAttemptEmail } from "../emails/sign-up-attempt";
import { WelcomeEmail } from "../emails/welcome";

import { sendEmail } from "./send-email";

type SendEmail = typeof sendEmail;

type MailerConfig = {
  apiKey: string;
  defaultReplyTo?: string;
  from?: string;
};

const DEFAULT_FROM = "Qolmeia <noreply@qolmeia.com>";

type WelcomePayload = {
  userEmail: string;
  userId: string;
  username?: string;
  verificationUrl: string;
};

type SignUpAttemptPayload = {
  resetPasswordUrl: string;
  signInUrl: string;
  userEmail: string;
  userId: string;
  username?: string;
};

type PasswordResetPayload = {
  browserInfo?: string;
  ipAddress?: string;
  resetUrl: string;
  userEmail: string;
  userId: string;
  username?: string;
};

type ChangeEmailPayload = {
  changeUrl: string;
  currentEmail: string;
  newEmail: string;
  userId: string;
  username?: string;
};

type MagicLinkPayload = {
  url: string;
  userEmail: string;
  userId?: string;
  username?: string;
};

type TransactionalEmail =
  | ({ type: "welcome" } & WelcomePayload)
  | ({ type: "sign-up-attempt" } & SignUpAttemptPayload)
  | ({ type: "password-reset" } & PasswordResetPayload)
  | ({ type: "change-email-confirmation" } & ChangeEmailPayload)
  | ({ type: "magic-link" } & MagicLinkPayload);

type EmailBuild = { subject: string; template: React.ReactElement; to: string };

type TemplateBuilder<P> = (payload: P) => EmailBuild;

const TEMPLATES = {
  "change-email-confirmation": ({
    changeUrl,
    currentEmail,
    newEmail,
    username,
  }: ChangeEmailPayload) => ({
    subject: "Confirm change of your Qolmeia account email",
    template: React.createElement(ChangeEmail, { changeUrl, currentEmail, newEmail, username }),
    to: currentEmail,
  }),
  "magic-link": ({ url, userEmail, username }: MagicLinkPayload) => ({
    subject: "Seu link de acesso à Qolmeia",
    template: React.createElement(MagicLinkEmail, { url, userEmail, username }),
    to: userEmail,
  }),
  "password-reset": ({
    browserInfo,
    ipAddress,
    resetUrl,
    userEmail,
    username,
  }: PasswordResetPayload) => ({
    subject: "Reset your Qolmeia password",
    template: React.createElement(PasswordResetEmail, {
      browserInfo,
      ipAddress,
      resetUrl,
      userEmail,
      username,
    }),
    to: userEmail,
  }),
  "sign-up-attempt": ({
    resetPasswordUrl,
    signInUrl,
    userEmail,
    username,
  }: SignUpAttemptPayload) => ({
    subject: "Sign-up attempt with your Qolmeia account",
    template: React.createElement(SignUpAttemptEmail, {
      resetPasswordUrl,
      signInUrl,
      userEmail,
      username,
    }),
    to: userEmail,
  }),
  welcome: ({ userEmail, username, verificationUrl }: WelcomePayload) => ({
    subject: `Welcome to Qolmeia${username !== undefined && username !== "" ? `, ${username}` : ""}! Please verify your email`,
    template: React.createElement(WelcomeEmail, { userEmail, username, verificationUrl }),
    to: userEmail,
  }),
} satisfies {
  "change-email-confirmation": TemplateBuilder<ChangeEmailPayload>;
  "magic-link": TemplateBuilder<MagicLinkPayload>;
  "password-reset": TemplateBuilder<PasswordResetPayload>;
  "sign-up-attempt": TemplateBuilder<SignUpAttemptPayload>;
  welcome: TemplateBuilder<WelcomePayload>;
};

const createTransactionalEmailSender =
  (send: SendEmail) => (email: TransactionalEmail, config: MailerConfig) => {
    // SAFETY: TEMPLATES satisfies a builder contract for every discriminant.
    // oxlint-disable-next-line no-unsafe-type-assertion
    const builder = TEMPLATES[email.type] as TemplateBuilder<typeof email>;
    const { subject, template, to } = builder(email);
    return send({
      apiKey: config.apiKey,
      defaultReplyTo: config.defaultReplyTo,
      from: config.from !== undefined && config.from !== "" ? config.from : DEFAULT_FROM,
      subject,
      tags: [
        { name: "type", value: email.type },
        ...(email.userId !== undefined && email.userId !== ""
          ? [{ name: "userId", value: email.userId }]
          : []),
      ],
      template,
      to,
    });
  };

const sendTransactionalEmail = createTransactionalEmailSender(sendEmail);

export type { MailerConfig, TransactionalEmail };
export { createTransactionalEmailSender, sendTransactionalEmail };
