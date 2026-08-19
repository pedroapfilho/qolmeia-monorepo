"use client";

import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { StatusPill, type StatusTone } from "@repo/ui/components/status-pill";
import { buttonVariants } from "@repo/ui/lib/button-variants";
import { toast } from "@repo/ui/lib/toast";
import type { Template, TemplateStatus } from "@repo/worker-api/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import { ApiError } from "@/lib/api-client";
import { fetchTemplates, setTemplateStatus, templateKeys } from "@/lib/templates-api";

type StatusLabelContract = Record<TemplateStatus, { label: string; tone: StatusTone }>;

const STATUS_LABEL = {
  active: { label: "Ativo", tone: "success" },
  retired: { label: "Desativado", tone: "neutral" },
} satisfies StatusLabelContract;

type TemplateRowProps = {
  busy: boolean;
  onToggle: (template: Template) => void;
  template: Template;
};

const TemplateRow = ({ busy, onToggle, template }: TemplateRowProps) => {
  const status = STATUS_LABEL[template.status];
  const toggleLabel = template.status === "retired" ? "Reativar" : "Desativar";
  return (
    <tr className="border-b border-border last:border-0 hover:bg-accent/40">
      <td className="px-5 py-3">
        <Link
          className="font-semibold text-foreground transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none"
          href={`/templates/${template.id}`}
        >
          {template.displayName}
        </Link>
      </td>
      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{template.workerKind}</td>
      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{template.model}</td>
      <td className="px-5 py-3 text-center text-muted-foreground tabular-nums">
        {template.skillIds.length}
      </td>
      <td className="px-5 py-3">
        <StatusPill label={status.label} tone={status.tone} />
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-2">
          <Link
            aria-label={`Editar ${template.displayName}`}
            className={buttonVariants({ size: "sm", variant: "outline" })}
            href={`/templates/${template.id}`}
          >
            Editar
          </Link>
          <Button
            aria-label={`${toggleLabel} ${template.displayName}`}
            disabled={busy}
            onClick={() => {
              onToggle(template);
            }}
            size="sm"
            variant="ghost"
          >
            {toggleLabel}
          </Button>
        </div>
      </td>
    </tr>
  );
};

type TemplatesTableBodyProps = {
  busy: boolean;
  isError: boolean;
  isLoading: boolean;
  onToggle: (template: Template) => void;
  templates: ReadonlyArray<Template>;
};

const TemplatesTableBody = ({
  busy,
  isError,
  isLoading,
  onToggle,
  templates,
}: TemplatesTableBodyProps) => {
  if (isLoading) {
    return (
      <p className="px-5 py-8 text-center text-sm text-muted-foreground">Carregando modelos…</p>
    );
  }
  if (isError) {
    return (
      <p className="px-5 py-8 text-center text-sm text-destructive">
        Não foi possível carregar os modelos.
      </p>
    );
  }
  if (templates.length === 0) {
    return (
      <EmptyState
        description="Crie o primeiro modelo de especialista para os times usarem."
        title="Nenhum modelo ainda"
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Modelos de especialistas</caption>
        <thead>
          <tr className="border-b border-border text-left font-mono text-xs tracking-wide text-muted-foreground uppercase">
            <th className="px-5 py-3 font-medium">Nome</th>
            <th className="px-5 py-3 font-medium">Tipo</th>
            <th className="px-5 py-3 font-medium">Modelo</th>
            <th className="px-5 py-3 text-center font-medium">Habilidades</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 text-right font-medium">Ações</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <TemplateRow busy={busy} key={template.id} onToggle={onToggle} template={template} />
          ))}
        </tbody>
      </table>
    </div>
  );
};

const TemplatesList = () => {
  const queryClient = useQueryClient();
  const { data, isError, isLoading } = useQuery({
    queryFn: fetchTemplates,
    queryKey: templateKeys.all,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TemplateStatus }) =>
      setTemplateStatus(id, status),
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? `Erro ${error.status}: ${error.body || "falha"}`
          : "Não foi possível alterar o status.";
      toast.error(message);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: templateKeys.all });
      toast.success(
        result.template.status === "retired" ? "Modelo desativado." : "Modelo reativado.",
      );
    },
  });

  const handleToggle = (template: Template) => {
    statusMutation.mutate({
      id: template.id,
      status: template.status === "retired" ? "active" : "retired",
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        actions={
          <Link className={buttonVariants()} href="/templates/new">
            Novo modelo
          </Link>
        }
        description="O catálogo de tipos de especialista que os times podem materializar."
        title="Modelos"
      />

      <Card className="overflow-hidden p-0">
        <TemplatesTableBody
          busy={statusMutation.isPending}
          isError={isError}
          isLoading={isLoading}
          onToggle={handleToggle}
          templates={data?.items ?? []}
        />
      </Card>
    </div>
  );
};

export { TemplatesList };
