export { createResendClient } from "./client";

export { Button } from "./components/button";
export { Card } from "./components/card";
export { Divider } from "./components/divider";
export { QolmeiaLogo } from "./components/qolmeia-logo";

export { sendEmail, sendBatchEmails, previewEmail } from "./utils/send-email";
export type { MailerConfig, TransactionalEmail } from "./utils/senders";
export { sendTransactionalEmail } from "./utils/senders";

export { emailTheme, tailwindConfig } from "./styles/theme";
