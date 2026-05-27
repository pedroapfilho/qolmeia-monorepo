import { Card, CardContent } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { ArrowRight, Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { StatusPill } from "@/components/status-pill";
import { apiGetServer } from "@/lib/api-server";
import type { ActionsResponse } from "@/lib/api-types";
import { formatDurationSeconds, truncate } from "@/lib/format";

export const metadata: Metadata = { title: "Aprovações" };

const ApprovalsPage = async () => {
  // `?status=pending&sort=age` returns oldest-first — the stale-backlog view.
  // Each row carries ageSeconds so the operator knows how long the customer
  // has been waiting.
  const res = await apiGetServer<ActionsResponse>("/actions?status=pending&sort=age");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Ações propostas pelos especialistas aguardando uma decisão do operador."
        title="Aprovações"
      />

      <Card>
        <CardContent className="px-0">
          {res.items.length === 0 ? (
            <EmptyState
              description="Os agentes estão executando livremente. Quando algo precisar do seu olho, aparece aqui."
              icon={<Inbox aria-hidden />}
              title="Sem nada na fila"
            />
          ) : (
            <ul className="flex flex-col">
              {res.items.map((action) => {
                const summary =
                  typeof action.proposed.summary === "string" ? action.proposed.summary : null;
                return (
                  <li
                    className="flex flex-col gap-3 border-b border-border px-6 py-5 last:border-b-0"
                    key={action.id}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {action.actionType}
                      </span>
                      <StatusPill status={action.status} />
                      {action.ageSeconds !== undefined && (
                        <span className="text-xs text-muted-foreground">
                          há {formatDurationSeconds(action.ageSeconds)}
                        </span>
                      )}
                    </div>
                    {summary ? (
                      <p className="text-sm leading-relaxed text-foreground">
                        {truncate(summary, 280)}
                      </p>
                    ) : null}
                    <div className="flex items-center gap-4 pt-1">
                      <Link
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
                        href={`/approvals/${action.id}`}
                      >
                        Abrir e decidir
                        <ArrowRight aria-hidden className="size-3.5" />
                      </Link>
                      <Link
                        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                        href={`/tickets/${action.ticketId}`}
                      >
                        Ver ticket
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ApprovalsPage;
