import { Card, CardContent } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { Ticket as TicketIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { StatusPill } from "@/components/status-pill";
import { apiGetServer } from "@/lib/api-server";
import type { TicketsResponse } from "@/lib/api-types";
import { formatRelative, truncate } from "@/lib/format";

export const metadata: Metadata = { title: "Tickets" };

const TicketsPage = async () => {
  const res = await apiGetServer<TicketsResponse>("/tickets?limit=50");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Trabalhos em curso e concluídos pelos especialistas da sua organização."
        title="Tickets"
      />

      <Card>
        <CardContent className="px-0">
          {res.items.length === 0 ? (
            <EmptyState
              description="Quando um cliente fizer um pedido, o Correspondente abre um ticket aqui."
              icon={<TicketIcon aria-hidden />}
              title="Nenhum ticket ainda"
            />
          ) : (
            <ul className="flex flex-col">
              {res.items.map((ticket) => (
                <li
                  className="flex flex-col gap-2 border-b border-border px-6 py-5 last:border-b-0"
                  key={ticket.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="text-sm font-semibold text-foreground transition-colors hover:text-primary"
                      href={`/tickets/${ticket.id}`}
                    >
                      {ticket.title}
                    </Link>
                    <StatusPill status={ticket.status} />
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {truncate(ticket.brief, 240)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">{ticket.origin}</span>
                    {" · "}
                    {formatRelative(ticket.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TicketsPage;
