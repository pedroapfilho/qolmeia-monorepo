"use client";

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Loader2, RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";

type ResetConversationButtonProps = {
  onReset: () => Promise<void>;
};

// Header action that clears the Correspondent conversation. Owns the confirm
// dialog + in-flight state; the actual reset (clearHistory + the DO RPC) is the
// caller's `onReset` so this component stays unaware of the chat plumbing.
const ResetConversationButton = ({ onReset }: ResetConversationButtonProps) => {
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleConfirm = useCallback(async () => {
    setResetting(true);
    try {
      await onReset();
      setOpen(false);
    } finally {
      setResetting(false);
    }
  }, [onReset]);

  return (
    <>
      <Button
        aria-label="Recomeçar a conversa"
        className="rounded-lg"
        onClick={() => setOpen(true)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <RotateCcw aria-hidden className="size-4" />
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Recomeçar a conversa?</DialogTitle>
            <DialogDescription>
              Isso apaga as mensagens deste chat. O Correspondente continua sabendo da sua empresa —
              só este histórico de conversa é limpo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={resetting}
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button
              disabled={resetting}
              onClick={handleConfirm}
              type="button"
              variant="destructive"
            >
              {resetting ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
              Recomeçar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export { ResetConversationButton };
