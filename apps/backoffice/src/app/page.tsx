import type { Metadata } from "next";

import { SignOutButton } from "@/components/sign-out-button";
import { requireSession } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Início" };

const Home = async () => {
  const session = await requireSession();

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12"
      id="main-content"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Qolmeia · Backoffice</h1>
        <p className="text-sm text-muted-foreground">
          Bem-vindo{session.user.name ? `, ${session.user.name}` : ""}. As telas
          operacionais (agentes, aprovações, atividade) chegam em breve.
        </p>
      </header>

      <dl className="grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            E-mail
          </dt>
          <dd className="text-sm text-foreground">{session.user.email}</dd>
        </div>
        {session.user.name && (
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Nome
            </dt>
            <dd className="text-sm text-foreground">{session.user.name}</dd>
          </div>
        )}
      </dl>

      <SignOutButton />
    </main>
  );
};

export default Home;
