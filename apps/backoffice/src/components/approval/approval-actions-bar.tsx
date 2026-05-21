"use client";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, apiSend } from "@/lib/api-client";

type ApprovalActionsBarProps = {
  actionId: string;
};

const ApprovalActionsBar = ({ actionId }: ApprovalActionsBarProps) => {
  const router = useRouter();
  const [pendingKind, setPendingKind] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [isRejectOpen, setIsRejectOpen] = useState(false);

  const finish = (kind: "approve" | "reject") => {
    toast.success(kind === "approve" ? "Aprovado." : "Rejeitado.");
    router.push("/approvals");
    router.refresh();
  };

  const handleApprove = async () => {
    if (pendingKind) {
      return;
    }
    setPendingKind("approve");
    try {
      await apiSend("POST", `/approvals/${actionId}/approve`, {});
      finish("approve");
    } catch (error) {
      const message = error instanceof ApiError ? `Erro ${error.status}` : "Falha ao aprovar.";
      toast.error(message);
    } finally {
      setPendingKind(null);
    }
  };

  const handleReject = async () => {
    if (pendingKind) {
      return;
    }
    setPendingKind("reject");
    try {
      const body = reason.trim() ? { reason: reason.trim() } : {};
      await apiSend("POST", `/approvals/${actionId}/reject`, body);
      finish("reject");
    } catch (error) {
      const message = error instanceof ApiError ? `Erro ${error.status}` : "Falha ao rejeitar.";
      toast.error(message);
    } finally {
      setPendingKind(null);
      setIsRejectOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {isRejectOpen && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
          <label className="text-sm font-medium" htmlFor="reject-reason">
            Motivo da rejeição (opcional)
          </label>
          <textarea
            className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            id="reject-reason"
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Por que esta ação está sendo rejeitada?"
            value={reason}
          />
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        {isRejectOpen ? (
          <>
            <Button
              disabled={pendingKind !== null}
              onClick={() => setIsRejectOpen(false)}
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
            <Button
              disabled={pendingKind !== null}
              onClick={handleReject}
              type="button"
              variant="destructive"
            >
              {pendingKind === "reject" ? "Rejeitando..." : "Confirmar rejeição"}
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={pendingKind !== null}
              onClick={() => setIsRejectOpen(true)}
              type="button"
              variant="destructive"
            >
              Rejeitar
            </Button>
            <Button disabled={pendingKind !== null} onClick={handleApprove} type="button">
              {pendingKind === "approve" ? "Aprovando..." : "Aprovar"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export { ApprovalActionsBar };
