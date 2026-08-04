import { Logo } from "@repo/ui/components/logo";
import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar",
};

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

const LoginPage = () => (
  <main
    className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10"
    id="main-content"
  >
    <div className="flex w-full max-w-sm flex-col items-center gap-8">
      <div className="flex flex-col items-center gap-3">
        <Logo className="h-7 w-auto" />
        <p className="text-sm text-muted-foreground">Chat com seu Time de IA</p>
      </div>
      <LoginForm />
    </div>
  </main>
);

export default LoginPage;
