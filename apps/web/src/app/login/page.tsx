import { Logo } from "@repo/ui/components/logo";
import { MessageSquareText, Sparkles, Workflow } from "lucide-react";
import type { Metadata } from "next";

import { LoginForm } from "./login-form";

const metadata: Metadata = {
  title: "Entrar",
};

/** @public Next.js App Router consumes this route config through the module loader. */
export const instant = true;

const CAPABILITIES = [
  {
    description: "Peças de marca criadas a partir do seu briefing.",
    icon: Sparkles,
    label: "Criação com contexto",
  },
  {
    description: "Do planejamento à entrega, sem trocar de ferramenta.",
    icon: Workflow,
    label: "Campanhas em fluxo",
  },
  {
    description: "Aprovações, entregas e histórico no mesmo lugar.",
    icon: MessageSquareText,
    label: "Tudo na conversa",
  },
] as const;

const LoginPage = () => (
  <main className="flex min-h-svh flex-col lg:grid lg:grid-cols-[3fr_2fr]" id="main-content">
    <section className="relative isolate flex flex-col justify-between gap-12 overflow-hidden border-b border-border px-6 pt-10 pb-9 sm:px-8 lg:border-r lg:border-b-0 lg:px-12 lg:py-14 xl:px-20">
      <Logo className="h-8 w-auto self-start" />

      <div>
        <p className="font-mono text-sm font-medium tracking-wide text-primary uppercase">
          Chat com seu Time de IA
        </p>
        <h1 className="mt-4 max-w-[30ch] font-display text-3xl font-semibold tracking-tight text-balance lg:text-5xl">
          Um time inteiro, na mesma conversa.
        </h1>
        <p className="mt-5 max-w-[48ch] text-lg text-pretty text-muted-foreground max-lg:hidden">
          Crie materiais de marca, organize campanhas e acompanhe o trabalho com os agentes da
          Qolmeia.
        </p>
        <dl className="mt-10 grid gap-6 text-sm max-lg:hidden">
          {CAPABILITIES.map(({ description, icon: Icon, label }) => (
            <div className="flex items-start gap-3" key={label}>
              <Icon aria-hidden="true" className="size-4 h-lh shrink-0 text-primary" />
              <div>
                <dt className="font-medium">{label}</dt>
                <dd className="mt-1 max-w-[56ch] text-muted-foreground">{description}</dd>
              </div>
            </div>
          ))}
        </dl>
      </div>

      <p className="text-sm text-muted-foreground max-lg:hidden">
        Acesso exclusivo para clientes convidados.
      </p>

      <div
        aria-hidden="true"
        className="absolute -right-32 -bottom-28 -z-10 honeycomb text-primary/10 max-lg:hidden"
      >
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </section>

    <section className="flex flex-1 items-center bg-card px-6 py-12 sm:px-8 lg:justify-center lg:px-12">
      <LoginForm />
    </section>
  </main>
);

export { metadata };

export default LoginPage;
