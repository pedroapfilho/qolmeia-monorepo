"use client";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, apiSend } from "@/lib/api-client";

type ApprovalActionsProps = {
  actionId: string;
};

const ApprovalActions = ({ actionId }: ApprovalActionsProps) => {
  const router = useRouter();
  const [pendingKind, setPendingKind] = useState<"approve" | "reject" | null>(null);

  const handle = async (kind: "approve" | "reject") => {
    if (pendingKind) {
      return;
    }
    setPendingKind(kind);
    try {
      await apiSend("POST", `/approvals/${actionId}/${kind}`, {});
      toast.success(kind === "approve" ? "Aprovado." : "Rejeitado.");
      router.refresh();
    } catch (error) {
      const message =
        error instanceof ApiError ? `Erro ${error.status}` : "Falha ao processar a ação.";
      toast.error(message);
    } finally {
      setPendingKind(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        disabled={pendingKind !== null}
        onClick={() => handle("reject")}
        size="sm"
        type="button"
        variant="destructive"
      >
        {pendingKind === "reject" ? "Rejeitando..." : "Rejeitar"}
      </Button>
      <Button
        disabled={pendingKind !== null}
        onClick={() => handle("approve")}
        size="sm"
        type="button"
      >
        {pendingKind === "approve" ? "Aprovando..." : "Aprovar"}
      </Button>
    </div>
  );
};

export { ApprovalActions };
