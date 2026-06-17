import type { ReactNode } from "react";

// The login page is self-contained (logo, tagline, card). This layout stays a
// transparent wrapper so the route renders a single <main> landmark.
const LoginLayout = ({ children }: { children: ReactNode }) => children;

export default LoginLayout;
