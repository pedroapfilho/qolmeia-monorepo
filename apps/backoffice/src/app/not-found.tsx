import { buttonVariants } from "@repo/ui/lib/button-variants";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Página não encontrada",
};

const NotFound = () => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
    <p className="text-8xl font-bold tracking-tight text-foreground">404</p>
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold text-foreground">Página não encontrada</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        A página que você está procurando não existe ou foi movida.
      </p>
    </div>
    <Link className={buttonVariants()} href="/">
      Ir para o início
    </Link>
  </div>
);

export default NotFound;
