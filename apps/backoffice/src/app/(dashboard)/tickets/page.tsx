import { Card, CardContent } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { Skeleton } from "@repo/ui/components/skeleton";
import { Ticket as TicketIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { StatusPill } from "@/components/status-pill";
import { apiGetServer } from "@/lib/api-server";
import type { TicketsResponse } from "@/lib/api-types";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Tickets" };

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
              <div className="grid grid-cols-[1fr_9rem_8.5rem_11rem_6rem] gap-3 border-b border-border bg-muted/40 px-6 py-3 font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">
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
                      className="grid grid-cols-[1fr_9rem_8.5rem_11rem_6rem] items-center gap-3 border-b border-border/60 px-6 py-3.5 transition-colors last:border-b-0 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                      href={`/tickets/${ticket.id}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {ticket.title}
                        </div>
                        <div className="font-mono text-[10.5px] text-muted-foreground">
                          {ticket.id}
                        </div>
                      </div>
                      <span className="truncate text-[13px] text-foreground/70">
                        {ticket.companyName}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-avatar-1 text-[10px] font-bold text-white"
                        >
                          {monogramOf(ticket.agentInstanceId)}
                        </span>
                        <span className="truncate text-[13px] text-foreground/70">
                          {ticket.agentInstanceId}
                        </span>
                      </div>
                      <StatusPill status={ticket.status} />
                      <span className="text-xs text-muted-foreground">
                        {formatRelative(ticket.updatedAt)}
                      </span>
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

// Static shell for the prerender: the table is bound to the per-request
// session cookie, so cacheComponents needs a Suspense boundary above it.
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
