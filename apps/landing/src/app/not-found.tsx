import { buttonVariants } from "@repo/ui/lib/button-variants";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Página não encontrada",
};

const NotFound = () => (
  <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-32 text-center sm:px-8">
    <p className="font-display text-8xl font-semibold tracking-tight">404</p>
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="max-w-[56ch] text-base text-pretty text-muted-foreground">
        A página que você está procurando não existe ou foi movida.
      </p>
    </div>
    <Link className={buttonVariants({ variant: "outline" })} href="/">
      Voltar ao início
    </Link>
  </div>
);

export default NotFound;
