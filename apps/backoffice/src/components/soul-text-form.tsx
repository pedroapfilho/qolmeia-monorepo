"use client";

import { Button } from "@repo/ui/components/button";
import { Field, FieldLabel } from "@repo/ui/components/field";
import { toast } from "@repo/ui/components/sonner";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";

import { ApiError, apiSend } from "@/lib/api-client";

type SoulField = "agentInstructions" | "businessIdea";

type SoulTextFormProps = {
  field: SoulField;
  hint?: string;
  initialValue: string;
  label: string;
};

const SoulTextForm = ({ field, hint, initialValue, label }: SoulTextFormProps) => {
  const router = useRouter();

  const form = useForm({
    defaultValues: { value: initialValue },
    onSubmit: async ({ value }) => {
      try {
        await apiSend("PUT", "/soul", { [field]: value.value });
        toast.success("Alterações salvas.");
        router.refresh();
      } catch (error) {
        const message =
          error instanceof ApiError ? `Erro ${error.status}` : "Não foi possível salvar.";
        toast.error(message);
      }
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void form.handleSubmit();
  };

  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={handleSubmit}>
      <form.Field name="value">
        {(formField) => (
          <Field>
            <FieldLabel htmlFor={formField.name}>{label}</FieldLabel>
            {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
            <textarea
              className="min-h-40 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              id={formField.name}
              name={formField.name}
              onBlur={formField.handleBlur}
              onChange={(event) => formField.handleChange(event.target.value)}
              value={formField.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => [state.isSubmitting, state.isDirty]}>
        {([isSubmitting, isDirty]) => (
          <div className="flex justify-end">
            <Button disabled={!isDirty || isSubmitting} size="sm" type="submit">
              {isSubmitting ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
};

export { SoulTextForm };
