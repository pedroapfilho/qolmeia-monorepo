"use client";

import { toast } from "@repo/ui/components/sonner";
import { useRouter } from "next/navigation";

import { ApiError, apiSend } from "@/lib/api-client";
import type { ApprovalDetail } from "@/lib/api-types";

import { SchemaForm } from "./schema-form";

type ApprovalEditorProps = {
  action: ApprovalDetail;
};

const ApprovalEditor = ({ action }: ApprovalEditorProps) => {
  const router = useRouter();

  const handleSubmit = async (newInput: unknown) => {
    try {
      await apiSend("POST", `/approvals/${action.id}/edit`, { newInput });
      toast.success("Edição salva.");
      router.push("/approvals");
      router.refresh();
    } catch (error) {
      const message =
        error instanceof ApiError ? `Erro ${error.status}` : "Não foi possível salvar a edição.";
      toast.error(message);
      // Re-throw so SchemaForm surfaces the error inline as well.
      throw new Error(message, { cause: error });
    }
  };

  const handleCancel = () => {
    router.push("/approvals");
  };

  return (
    <SchemaForm
      initialValue={action.proposedInput}
      onCancel={handleCancel}
      onSubmit={handleSubmit}
      schema={action.skill.parametersJsonSchema}
    />
  );
};

export { ApprovalEditor };
