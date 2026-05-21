// Client
export { createResendClient } from "./client";

// Components
export { Button } from "./components/button";
export { Card } from "./components/card";
export { Divider } from "./components/divider";
export { QolmeiaLogo } from "./components/qolmeia-logo";

// Utilities
export { sendEmail, sendBatchEmails, previewEmail } from "./utils/send-email";
export {
  sendChangeEmailConfirmation,
  sendMagicLinkEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendSignUpAttemptEmail,
} from "./utils/senders";

// Theme
export { emailTheme, tailwindConfig } from "./styles/theme";
