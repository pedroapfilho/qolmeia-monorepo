"use client";

import { authClient } from "@repo/app-shell/auth-client";
import { Button } from "@repo/ui/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/lib/toast";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { magicLinkSchema } from "@/lib/form-schemas";

const LoginForm = () => {
  const [sent, setSent] = useState(false);

  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      const callbackURL = `${window.location.origin}/auth/verify`;
      try {
        const { error } = await authClient.signIn.magicLink({
          callbackURL,
          email: value.email,
        });
        if (error) {
          toast.error(error.message ?? "Não foi possível enviar o link. Tente novamente.");
          return;
        }
      } catch {
        toast.error("Não foi possível conectar ao servidor. Tente novamente.");
        return;
      }
      setSent(true);
    },
    validators: { onSubmit: magicLinkSchema },
  });

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void form.handleSubmit();
  };

  if (sent) {
    return (
      <div className="w-full max-w-xs">
        <h2 className="font-display text-2xl font-semibold tracking-tight">Verifique seu e-mail</h2>
        <p className="mt-3 max-w-[56ch] text-base text-pretty text-muted-foreground sm:text-sm">
          Enviamos um link mágico para você. Abra o e-mail e clique no link para entrar.
        </p>
        <Button
          className="mt-8 w-full"
          onClick={() => {
            setSent(false);
          }}
          type="button"
          variant="outline"
        >
          Usar outro e-mail
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xs">
      <h2 className="font-display text-2xl font-semibold tracking-tight">Entrar</h2>
      <p className="mt-3 max-w-[56ch] text-base text-pretty text-muted-foreground sm:text-sm">
        Use o e-mail no qual você recebeu o convite. Vamos te enviar um link mágico.
      </p>
      <form className="mt-8" noValidate onSubmit={handleSubmit}>
        <FieldGroup>
          <form.Field name="email">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid || undefined}>
                  <FieldLabel htmlFor={field.name}>E-mail</FieldLabel>
                  <Input
                    aria-invalid={isInvalid}
                    autoComplete="email"
                    id={field.name}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                    }}
                    placeholder="voce@empresa.com"
                    type="email"
                    value={field.state.value}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
        </FieldGroup>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button
              className="mt-6 w-full"
              disabled={!canSubmit || isSubmitting}
              size="lg"
              type="submit"
            >
              {isSubmitting ? "Enviando…" : "Enviar link mágico"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
};

export { LoginForm };
