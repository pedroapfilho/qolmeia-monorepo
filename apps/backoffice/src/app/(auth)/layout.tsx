import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Entrar",
};

const AuthLayout = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
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
      <p className="mx-auto text-xs text-muted-foreground">Painel operacional</p>
    </div>
  </div>
);

export default AuthLayout;
