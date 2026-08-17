import { buttonVariants } from "@repo/ui/lib/button-variants";
import { CheckCircle2, MessagesSquare, Workflow } from "lucide-react";
import type { Metadata } from "next";

import { webAppUrl } from "@/lib/urls";

export const metadata: Metadata = {
  description:
    "Peça na conversa, acompanhe o trabalho e aprove as entregas. A Qolmeia monta um time de agentes de IA para a sua marca.",
  title: { absolute: "Qolmeia · Um time de IA que trabalha na conversa" },
};

/** @public Next.js App Router reads the instant segment config through the module loader. */
export const instant = true;

const STEPS = [
  {
    description: "Você conta o que a marca precisa. O time entende o contexto antes de produzir.",
    icon: MessagesSquare,
    title: "Comece pela conversa",
  },
  {
    description: "Cada pedido vira uma tarefa com responsável, prazo e histórico visível.",
    icon: Workflow,
    title: "O time se organiza",
  },
  {
    description: "Nada é publicado sem o seu aval. Você aprova, ajusta ou recomeça.",
    icon: CheckCircle2,
    title: "Você aprova a entrega",
  },
] as const;

/* Tones are the role-keyed avatar hues from the design system, matching the
   monograms the chat surface renders for the same agents. */
const ROSTER = [
  { name: "Correspondente", role: "Recebe seus pedidos e coordena o time", tone: "bg-avatar-1" },
  { name: "Designer", role: "Cria as peças visuais", tone: "bg-avatar-2" },
  { name: "Estrategista", role: "Traduz a marca em plano de campanha", tone: "bg-avatar-3" },
  { name: "Redator", role: "Escreve os textos", tone: "bg-avatar-4" },
  { name: "Social", role: "Adapta tudo para cada canal", tone: "bg-avatar-5" },
  { name: "Planner", role: "Organiza o calendário de publicação", tone: "bg-avatar-6" },
] as const;

const Page = () => (
  <>
    <section className="relative isolate overflow-hidden border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:px-8 lg:py-32">
        <p className="font-mono text-sm font-medium tracking-wide text-primary uppercase">
          Chat com seu Time de IA
        </p>
        <h1 className="mt-5 max-w-[24ch] font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
          Um time inteiro, na mesma conversa.
        </h1>
        <p className="mt-6 max-w-[48ch] text-lg text-pretty text-muted-foreground">
          A Qolmeia monta um time de agentes de IA para a sua marca. Você pede no chat, acompanha o
          trabalho acontecendo e aprova cada entrega.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a className={buttonVariants({ size: "lg" })} href={webAppUrl("/login")}>
            Entrar na conversa
          </a>
          <a className={buttonVariants({ size: "lg", variant: "ghost" })} href="#como-funciona">
            Ver como funciona
          </a>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="absolute -right-32 -bottom-28 -z-10 honeycomb text-primary/10 max-lg:hidden"
      >
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </section>

    <section className="border-b border-border" id="como-funciona">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:py-24">
        <h2 className="max-w-[35ch] font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Do pedido à entrega, sem trocar de ferramenta.
        </h2>
        <p className="mt-5 max-w-[48ch] text-lg text-pretty text-muted-foreground">
          Todo o trabalho acontece em um lugar só: o briefing, a produção, as aprovações e o
          histórico.
        </p>
        <dl className="mt-14 grid gap-10 sm:grid-cols-3">
          {STEPS.map(({ description, icon: Icon, title }) => (
            <div key={title}>
              <dt className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
                <Icon aria-hidden="true" className="size-4 h-lh shrink-0 text-primary" />
                {title}
              </dt>
              <dd className="mt-3 max-w-[48ch] text-base text-pretty text-muted-foreground">
                {description}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>

    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:py-24">
        <h2 className="max-w-[35ch] font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Quem trabalha com você.
        </h2>
        <p className="mt-5 max-w-[48ch] text-lg text-pretty text-muted-foreground">
          Cada agente tem uma função clara. O time é montado a partir do que a sua marca precisa.
        </p>
        <dl className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {ROSTER.map(({ name, role, tone }) => (
            <div className="flex items-start gap-4" key={name}>
              <span
                aria-hidden="true"
                className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${tone}`}
              >
                {name[0]}
              </span>
              <div>
                <dt className="font-medium">{name}</dt>
                <dd className="mt-1 max-w-[48ch] text-base text-pretty text-muted-foreground">
                  {role}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </section>

    <section>
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-20 text-center sm:px-8 lg:py-24">
        <h2 className="max-w-[30ch] font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Pronto para começar?
        </h2>
        <p className="max-w-[48ch] text-lg text-pretty text-muted-foreground">
          O acesso é exclusivo para clientes convidados. Use o e-mail no qual você recebeu o
          convite.
        </p>
        <a
          className={buttonVariants({ size: "lg", variant: "secondary" })}
          href={webAppUrl("/login")}
        >
          Entrar na conversa
        </a>
      </div>
    </section>
  </>
);

export default Page;
