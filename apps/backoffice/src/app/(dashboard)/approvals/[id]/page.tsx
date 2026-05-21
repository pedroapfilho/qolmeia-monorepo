import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createElement } from "react";

import { ApprovalActionsBar } from "@/components/approval/approval-actions-bar";
import { ApprovalEditor } from "@/components/approval/approval-editor";
import { getSkillRenderer } from "@/components/approval/skill-renderers";
import { ApiError } from "@/lib/api-client";
import { apiGetServer } from "@/lib/api-server";
import type { ApprovalDetail } from "@/lib/api-types";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Revisar aprovação" };

type ApprovalDetailPageProps = {
  params: Promise<{ id: string }>;
};

const ApprovalDetailPage = async ({ params }: ApprovalDetailPageProps) => {
  const { id } = await params;

  let detail: { action: ApprovalDetail };
  try {
    detail = await apiGetServer<{ action: ApprovalDetail }>(`/approvals/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const { action } = detail;
  const SkillRenderer = getSkillRenderer(action.skillId);

  return (
    <div className="flex flex-col gap-6">
      <Link
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        href="/approvals"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Voltar para aprovações
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{action.skill.displayName}</h1>
        <p className="text-sm text-muted-foreground">
          Agente {action.agentInstance.displayName} ·{" "}
          <time dateTime={action.createdAt}>{formatRelative(action.createdAt)}</time>
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Proposta</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{action.proposedSummary}</p>
        </CardContent>
      </Card>

      {SkillRenderer && (
        <Card>
          <CardContent className="py-5">{createElement(SkillRenderer, { action })}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Editar input</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <ApprovalEditor action={action} />
          <div className="border-t border-border pt-4">
            <ApprovalActionsBar actionId={action.id} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ApprovalDetailPage;
