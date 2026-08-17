import { Logo } from "@repo/ui/components/logo";
import { buttonVariants } from "@repo/ui/lib/button-variants";
import Link from "next/link";

import { webAppUrl } from "@/lib/urls";

const Header = () => (
  <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
    <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:px-8">
      <Link aria-label="Página inicial" href="/">
        <Logo className="h-7 w-auto" />
      </Link>
      <nav aria-label="Principal">
        <a className={buttonVariants({ variant: "ghost" })} href={webAppUrl("/login")}>
          Entrar
        </a>
      </nav>
    </div>
  </header>
);

export { Header };
