"use client";

import { Button } from "@repo/ui/components/button";
import { Field, FieldDescription } from "@repo/ui/components/field";
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
    <section aria-label="Prompt do agente" className="flex flex-col gap-3">
      <div className="flex items-center">
        <span className="text-sm font-bold text-foreground">Prompt do agente</span>
        <span className="ml-auto font-mono text-[10.5px] tracking-wide text-muted-foreground">
          editável
        </span>
      </div>

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Padrão do template
        </summary>
        <pre className="mt-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {templatePrompt}
        </pre>
      </details>

      <Field>
        <Textarea
          className="min-h-[150px] resize-y text-[13.5px] leading-relaxed"
          disabled={busy}
          id="prompt-editor"
          onChange={(e) => {
            setValue(e.target.value);
          }}
          placeholder="Escreva instruções específicas para este agente, em pt-BR."
          rows={8}
          value={value}
        />
        <FieldDescription>
          {overridden && updatedAt !== null
            ? `Você modificou este prompt em ${formatDate(updatedAt)}. Mudanças passam a valer na próxima interação.`
            : "Mudanças passam a valer na próxima interação."}
        </FieldDescription>
      </Field>

      <div className="flex gap-2">
        <Button
          disabled={busy === true || !dirty}
          onClick={() => {
            void onSave(value);
          }}
        >
          Salvar prompt
        </Button>
        <Button
          disabled={busy === true || !overridden}
          onClick={() => {
            void (async () => {
              await onReset();
              setValue("");
            })();
          }}
          variant="ghost"
        >
          Descartar
        </Button>
      </div>
    </section>
  );
};

export { PromptEditor };
