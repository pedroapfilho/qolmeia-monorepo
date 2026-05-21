import { Card, CardContent } from "@repo/ui/components/card";
import type { Metadata } from "next";
import Link from "next/link";

import { ApprovalActions } from "@/components/approval-actions";
import { apiGetServer } from "@/lib/api-server";
import type { ApprovalRow, Paginated } from "@/lib/api-types";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Aprovações" };

const ApprovalsPage = async () => {
  const res = await apiGetServer<Paginated<ApprovalRow>>("/approvals?limit=20");
  const approvals = res.items;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Aprovações</h1>
        <p className="text-sm text-muted-foreground">
          Ações propostas pelos agentes que aguardam decisão.
        </p>
      </header>

      {approvals.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma aprovação pendente. Tudo em dia.
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {approvals.map((row) => (
            <li key={row.id}>
              <Card>
                <CardContent className="flex flex-col gap-3 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-medium">{row.proposedSummary}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.skill.displayName} · {row.agentTemplateDisplayName} ·{" "}
                        <time dateTime={row.createdAt}>{formatRelative(row.createdAt)}</time>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
                        href={`/approvals/${row.id}`}
                      >
                        Revisar
                      </Link>
                      <ApprovalActions actionId={row.id} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ApprovalsPage;
