import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import type { Metadata } from "next";

import { SoulTextForm } from "@/components/soul-text-form";
import { apiGetServer } from "@/lib/api-server";
import type { SoulPayload } from "@/lib/api-types";

export const metadata: Metadata = { title: "Soul" };

const SoulPage = async () => {
  const soul = await apiGetServer<SoulPayload>("/soul");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Soul</h1>
        <p className="text-sm text-muted-foreground">
          Contexto do negócio que alimenta os agentes — ideia, instruções e o perfil extraído.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Ideia do negócio</CardTitle>
          <CardDescription>
            Descrição curta usada como contexto pelos agentes em todas as conversas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SoulTextForm
            field="businessIdea"
            initialValue={soul.businessIdea ?? ""}
            label="Ideia do negócio"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Instruções para a equipe de IA</CardTitle>
          <CardDescription>
            Diretrizes operacionais que os agentes seguem ao responder e agir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SoulTextForm
            field="agentInstructions"
            initialValue={soul.agentInstructions ?? ""}
            label="Instruções"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Soul JSON</CardTitle>
          <CardDescription>
            Perfil estruturado do negócio extraído pela equipe de IA. Edição reservada ao
            proprietário (em breve).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {soul.businessProfile ? (
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs">
              {JSON.stringify(soul.businessProfile, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum perfil definido ainda.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SoulPage;
