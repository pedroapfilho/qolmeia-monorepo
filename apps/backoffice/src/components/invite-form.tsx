"use client";

import { Button } from "@repo/ui/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/components/sonner";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, apiSend } from "@/lib/api-client";
import { inviteSchema } from "@/lib/form-schemas";

type Role = "STAFF" | "CUSTOMER";

// Side-panel invite form. Closes itself + refreshes the team page on
// success. The role select drives the email template chosen on the API
// side (magic-link for CUSTOMER, welcome email for STAFF).
const InviteForm = ({ onClose }: { onClose: () => void }) => {
  const router = useRouter();
  const [role, setRole] = useState<Role>("CUSTOMER");

  const form = useForm({
    defaultValues: { email: "", name: "", role: "CUSTOMER" as Role },
    onSubmit: async ({ value }) => {
      try {
        await apiSend("POST", "/team/invite", {
          email: value.email,
          name: value.name,
          role,
        });
        toast.success("Convite enviado.");
        router.refresh();
        onClose();
      } catch (error) {
        const message =
          error instanceof ApiError && error.status === 422
            ? "Verifique os campos e tente novamente."
            : "Não foi possível enviar o convite.";
        toast.error(message);
      }
    },
    validators: { onChange: inviteSchema },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void form.handleSubmit();
  };

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <FieldGroup>
        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Nome</FieldLabel>
              <Input
                autoComplete="name"
                id={field.name}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Maria da Silva"
                type="text"
                value={field.state.value}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="email">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>E-mail</FieldLabel>
              <Input
                autoComplete="email"
                id={field.name}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="maria@empresa.com"
                type="email"
                value={field.state.value}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <Field>
          <FieldLabel htmlFor="invite-role">Papel</FieldLabel>
          <select
            className="h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            id="invite-role"
            name="role"
            onChange={(event) => setRole(event.target.value as Role)}
            value={role}
          >
            <option value="CUSTOMER">Cliente (acesso ao chat)</option>
            <option value="STAFF">Equipe (acesso ao painel)</option>
          </select>
        </Field>
      </FieldGroup>

      <div className="flex justify-end gap-2">
        <Button onClick={onClose} type="button" variant="ghost">
          Cancelar
        </Button>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button disabled={!canSubmit || isSubmitting} type="submit">
              {isSubmitting ? "Enviando..." : "Enviar convite"}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
};

export { InviteForm };
