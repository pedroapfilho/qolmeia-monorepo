import { Card, CardContent } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageContainer } from "@repo/ui/components/page-container";
import { PageHeader } from "@repo/ui/components/page-header";
import { Activity } from "lucide-react";
import type { Metadata } from "next";

import { apiGetServer } from "@/lib/api-server";
import type { ListResponse } from "@/lib/api-types";
import { log } from "@/lib/observability";

export const metadata: Metadata = {
  title: "Atividade",
};

/**
 * Authenticated surface bound to the per-request session cookie (`/api/me/activity`);
 * block so each request reads fresh activity rather than a cached empty shell.
 * @public Next.js app-router reads the `instant` route config via the module loader
 */
export const instant = false;

type ActivityRow = {
  createdAt: string;
  id: string;
  summary: string;
  type: string;
};

const loadActivity = async (): Promise<ReadonlyArray<ActivityRow>> => {
  try {
    const result = await apiGetServer<ListResponse<ActivityRow>>("/api/me/activity?limit=50");
    return result.items;
  } catch (error) {
    log.error({ error, message: "activity: failed to load" });
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
    <PageContainer>
      <PageHeader
        description="Tudo que rolou no seu chat — mensagens trocadas, execuções dos agentes, ações concluídas."
        title="Atividade"
      />

      <Card>
        <CardContent className="px-0">
          {rows.length === 0 ? (
            <EmptyState
              description="Quando o seu Time começar a trabalhar, os eventos aparecem aqui."
              icon={<Activity aria-hidden />}
              title="Nenhuma atividade ainda"
            />
          ) : (
            <ul className="flex flex-col">
              {rows.map((row) => (
                <li
                  className="flex gap-3 border-b border-border px-6 py-4 last:border-b-0"
                  key={row.id}
                >
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-sm leading-relaxed text-foreground">{row.summary}</p>
                    <time
                      className="font-mono text-xs tracking-wide text-muted-foreground uppercase"
                      dateTime={row.createdAt}
                    >
                      {formatTime(row.createdAt)}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
};

export default ActivityPage;
