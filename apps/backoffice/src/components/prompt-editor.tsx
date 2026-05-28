"use client";

import { Button } from "@repo/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@repo/ui/components/field";
import { Textarea } from "@repo/ui/components/textarea";
import { useState } from "react";

type PromptEditorProps = {
  busy?: boolean;
  initialValue: string | null;
  onReset: () => Promise<void>;
  onSave: (value: string) => Promise<void>;
  templatePrompt: string;
  updatedAt: number | null;
};

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });

const PromptEditor = ({
  busy,
  initialValue,
  onReset,
  onSave,
  templatePrompt,
  updatedAt,
}: PromptEditorProps) => {
  const [value, setValue] = useState(initialValue ?? "");
  const overridden = initialValue !== null;
  const dirty = value !== (initialValue ?? "");

  return (
    <section aria-label="Comportamento do agente" className="flex flex-col gap-3">
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Padrão do template</summary>
        <pre className="mt-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {templatePrompt}
        </pre>
      </details>
      <Field>
        <FieldLabel htmlFor="prompt-editor">Sua personalização</FieldLabel>
        <Textarea
          disabled={busy}
          id="prompt-editor"
          onChange={(e) => setValue(e.target.value)}
          placeholder="Escreva instruções específicas para este agente, em pt-BR."
          rows={8}
          value={value}
        />
        <FieldDescription>
          {overridden && updatedAt
            ? `Você modificou este prompt em ${formatDate(updatedAt)}. Mudanças passam a valer na próxima interação.`
            : "Mudanças passam a valer na próxima interação."}
        </FieldDescription>
      </Field>
      <div className="flex justify-end gap-2">
        <Button
          disabled={busy || !overridden}
          onClick={async () => {
            await onReset();
            setValue("");
          }}
          variant="outline"
        >
          Restaurar padrão
        </Button>
        <Button disabled={busy || !dirty} onClick={() => onSave(value)}>
          Salvar
        </Button>
      </div>
    </section>
  );
};

export { PromptEditor };
