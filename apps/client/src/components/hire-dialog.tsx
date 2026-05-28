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
import { Field, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/lib/toast";
import { useState } from "react";

import { hireMember, type HireableTemplate } from "@/lib/team";

type HireDialogProps = {
  onClose: () => void;
  onHired: () => void;
  open: boolean;
  template: HireableTemplate | null;
};

const HireDialog = ({ onClose, onHired, open, template }: HireDialogProps) => {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!template) {
      return;
    }
    setBusy(true);
    try {
      const member = await hireMember({
        displayName: name.trim() || undefined,
        templateId: template.id,
      });
      toast.success(`${member.displayName} contratado(a).`);
      onHired();
      onClose();
      setName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao contratar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={(o) => !o && onClose()} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contratar {template?.displayName ?? ""}</DialogTitle>
          <DialogDescription>
            Você pode dar um nome próprio a este agente. Se deixar em branco, usamos o nome do
            template (com #2, #3, … se já existir).
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="hire-name">Nome (opcional)</FieldLabel>
          <Input
            disabled={busy}
            id="hire-name"
            onChange={(e) => setName(e.target.value)}
            placeholder={template?.displayName ?? ""}
            value={name}
          />
        </Field>
        <DialogFooter>
          <Button disabled={busy} onClick={onClose} variant="outline">
            Cancelar
          </Button>
          <Button disabled={busy} onClick={confirm}>
            Contratar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export { HireDialog };
