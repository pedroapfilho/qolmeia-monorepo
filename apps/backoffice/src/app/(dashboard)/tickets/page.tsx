import { Card, CardContent } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { Skeleton } from "@repo/ui/components/skeleton";
import type { TicketsResponse } from "@repo/worker-api/contracts";
import { Ticket as TicketIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { StatusPill } from "@/components/status-pill";
import { apiGetServer } from "@/lib/api-server";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Tickets" };

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

const monogramOf = (value: string): string => (value.trim()[0] ?? "?").toLocaleUpperCase("pt-BR");

const TicketsContent = async () => {
  const res = await apiGetServer<TicketsResponse>("/tickets?limit=50");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Unidades de trabalho delegado · todas as empresas."
        title="Tickets"
      />

      <Card className="gap-0 overflow-hidden p-0">
        <CardContent className="p-0">
          {res.items.length === 0 ? (
            <EmptyState
              description="Quando um cliente fizer um pedido, o Correspondente abre um ticket aqui."
              icon={<TicketIcon aria-hidden />}
              title="Nenhum ticket ainda"
            />
          ) : (
            <div>
              <div className="hidden grid-cols-[1fr_9rem_8.5rem_11rem_6rem] gap-3 border-b border-border bg-muted/40 px-6 py-3 font-mono text-[0.65625rem] tracking-wide text-muted-foreground uppercase md:grid">
                <span>Entregável</span>
                <span>Empresa</span>
                <span>Agente</span>
                <span>Status</span>
                <span>Atualizado</span>
              </div>
              <ul className="flex flex-col">
                {res.items.map((ticket) => (
                  <li key={ticket.id}>
                    <Link
                      className="grid gap-3 border-b border-border/60 px-4 py-4 transition-colors last:border-b-0 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none sm:grid-cols-2 md:grid-cols-[1fr_9rem_8.5rem_11rem_6rem] md:items-center md:px-6 md:py-3.5"
                      href={`/tickets/${ticket.id}`}
                    >
                      <div className="min-w-0 sm:col-span-2 md:col-span-1">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {ticket.title}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">{ticket.id}</div>
                      </div>
                      <div className="min-w-0">
                        <span className="mb-1 block text-xs font-medium text-muted-foreground md:hidden">
                          Empresa
                        </span>
                        <span className="block truncate text-[0.8125rem] text-foreground/70">
                          {ticket.companyName}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="mb-1 block text-xs font-medium text-muted-foreground md:hidden">
                          Agente
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-avatar-1 text-[0.625rem] font-bold text-white"
                          >
                            {monogramOf(ticket.agentInstanceId)}
                          </span>
                          <span className="truncate text-[0.8125rem] text-foreground/70">
                            {ticket.agentInstanceId}
                          </span>
                        </div>
                      </div>
                      <div>
                        <span className="mb-1 block text-xs font-medium text-muted-foreground md:hidden">
                          Status
                        </span>
                        <StatusPill status={ticket.status} />
                      </div>
                      <div>
                        <span className="mb-1 block text-xs font-medium text-muted-foreground md:hidden">
                          Atualizado
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelative(ticket.updatedAt)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const TicketsSkeleton = () => (
  <div aria-hidden className="flex flex-col gap-6">
    <PageHeader description="Unidades de trabalho delegado · todas as empresas." title="Tickets" />
    <Card className="gap-0 overflow-hidden p-0">
      <CardContent className="flex flex-col gap-4 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  </div>
);

const TicketsPage = () => (
  <Suspense fallback={<TicketsSkeleton />}>
    <TicketsContent />
  </Suspense>
);

export default TicketsPage;
