import { Logo } from "@repo/ui/components/logo";
import { MessageSquareText, Sparkles, Workflow } from "lucide-react";
import type { Metadata } from "next";

import { LoginForm } from "./login-form";

const metadata: Metadata = {
  title: "Entrar",
};

const instant = true;

const CAPABILITIES = [
  { icon: Sparkles, label: "Criação com contexto" },
  { icon: Workflow, label: "Campanhas em fluxo" },
  { icon: MessageSquareText, label: "Tudo na conversa" },
] as const;

const LoginPage = () => (
  <main className="qolmeia-entry grid min-h-svh lg:grid-cols-[1.05fr_0.95fr]" id="main-content">
    <section className="relative flex flex-col justify-between overflow-hidden border-b border-border px-6 py-10 lg:border-r lg:border-b-0 lg:px-12 lg:py-12 xl:px-20">
      <Logo className="relative z-10 h-8 w-auto self-start" />
      <div className="relative z-10 my-16 max-w-xl lg:my-24">
        <p className="font-mono text-xs font-medium tracking-[0.14em] text-primary uppercase">
          Chat com seu Time de IA
        </p>
        <h1 className="mt-5 max-w-[13ch] font-display text-5xl leading-[1.03] font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
          Um time inteiro, na mesma conversa.
        </h1>
        <p className="mt-6 max-w-[46ch] text-lg text-pretty text-muted-foreground">
          Crie materiais de marca, organize campanhas e acompanhe o trabalho com os agentes da
          Qolmeia.
        </p>
        <dl className="mt-10 grid gap-3 sm:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, label }) => (
            <div className="border-l-2 border-primary pl-3" key={label}>
              <dt className="flex items-center gap-2 text-sm font-medium">
                <Icon aria-hidden="true" className="size-4 text-primary" />
                {label}
              </dt>
            </div>
          ))}
        </dl>
      </div>
      <p className="relative z-10 text-xs text-muted-foreground">
        Acesso exclusivo para clientes convidados.
      </p>
      <div aria-hidden="true" className="honeycomb-cluster">
        {Array.from({ length: 7 }, (_, index) => (
          <span className="honeycomb-cell" key={index} />
        ))}
      </div>
    </section>

    <section className="flex items-center justify-center bg-card/45 px-4 py-12 sm:px-8 lg:px-12">
      <div className="w-full max-w-md">
        <p className="mb-5 font-mono text-xs text-muted-foreground">ACESSO SEGURO · LINK MÁGICO</p>
        <LoginForm />
      </div>
    </section>
  </main>
);

export { instant, metadata };

export default LoginPage;
