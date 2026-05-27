import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Entrar",
};

const LoginLayout = ({ children }: { children: ReactNode }) => (
  <main
    className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12"
    id="main-content"
  >
    <div className="flex w-full max-w-md flex-col gap-6">
      <Link
        aria-label="Qolmeia"
        className="mx-auto inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground transition-opacity hover:opacity-80"
        href="/"
      >
        <span
          aria-hidden
          className="flex size-7 items-center justify-center rounded-md bg-foreground text-xs font-bold text-background"
        >
          Q
        </span>
        Qolmeia
      </Link>
      {children}
      <p className="mx-auto text-xs text-muted-foreground">Chat com seu Time de IA</p>
    </div>
  </main>
);

export default LoginLayout;
