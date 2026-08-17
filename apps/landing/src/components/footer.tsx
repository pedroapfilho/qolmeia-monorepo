import { Logo } from "@repo/ui/components/logo";

import { webAppUrl } from "@/lib/urls";

const Footer = () => (
  <footer className="border-t border-border">
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <Logo className="h-6 w-auto" />
      <nav aria-label="Rodapé">
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-normal">
          <li>
            <a className="text-muted-foreground hover:text-foreground" href={webAppUrl("/login")}>
              Entrar
            </a>
          </li>
          <li>
            <a
              className="text-muted-foreground hover:text-foreground"
              href="mailto:contato@qolmeia.com"
            >
              Falar com a gente
            </a>
          </li>
        </ul>
      </nav>
      {/* No year: reading the clock breaks the static prerender under
          cacheComponents, and a build-time year silently goes stale. */}
      <p className="text-sm text-muted-foreground">&copy; Qolmeia</p>
    </div>
  </footer>
);

export { Footer };
