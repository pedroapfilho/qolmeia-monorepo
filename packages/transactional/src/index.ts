export { createResendClient } from "./client";

export { Button } from "./components/button";
export { Card } from "./components/card";
export { Divider } from "./components/divider";
export { QolmeiaLogo } from "./components/qolmeia-logo";

export { sendEmail, sendBatchEmails, previewEmail } from "./utils/send-email";
export {
  sendChangeEmailConfirmation,
  sendMagicLinkEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendSignUpAttemptEmail,
} from "./utils/senders";

export { emailTheme, tailwindConfig } from "./styles/theme";
