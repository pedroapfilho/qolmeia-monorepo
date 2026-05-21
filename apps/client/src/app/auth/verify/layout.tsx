import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Verificando...",
};

const VerifyLayout = ({ children }: { children: ReactNode }) => (
  <main
    className="flex min-h-screen items-center justify-center bg-background px-4 py-12"
    id="main-content"
  >
    <div className="w-full max-w-md">{children}</div>
  </main>
);

export default VerifyLayout;
