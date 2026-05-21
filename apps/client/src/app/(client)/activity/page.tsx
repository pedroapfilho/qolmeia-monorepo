import { Card, CardContent } from "@repo/ui/components/card";
import type { Metadata } from "next";

import { apiGetServer } from "@/lib/api-server";
import type { ListResponse } from "@/lib/api-types";

export const metadata: Metadata = {
  title: "Atividade",
};

type ActivityRow = {
  createdAt: string;
  id: string;
  summary: string;
  type: string;
};

const loadActivity = async (): Promise<ReadonlyArray<ActivityRow>> => {
  try {
    const result = await apiGetServer<ListResponse<ActivityRow>>("/web-chat/activity?limit=50");
    return result.items;
  } catch (error) {
    console.error("[activity] failed to load", { error });
    return [];
  }
};

const formatTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const ActivityPage = async () => {
  const rows = await loadActivity();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Atividade</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tudo que rolou no seu chat — mensagens trocadas, execuções dos agentes, ações concluídas.
        </p>
      </header>

      <Card>
        <CardContent className="px-0">
          {rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Nenhuma atividade ainda.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li className="flex items-start gap-3 px-6 py-3" key={row.id}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{row.summary}</p>
                    <time className="text-xs text-muted-foreground" dateTime={row.createdAt}>
                      {formatTime(row.createdAt)}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ActivityPage;
