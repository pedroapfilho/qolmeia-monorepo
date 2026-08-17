"use client";

import { authClient } from "@repo/app-shell/auth-client";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
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
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="font-display text-2xl tracking-tight">
            Verifique seu e-mail
          </CardTitle>
          <CardDescription>
            Enviamos um link mágico para você. Abra o e-mail e clique no link para entrar.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-3 pt-6">
          <Button
            className="w-full"
            onClick={() => {
              setSent(false);
            }}
            type="button"
            variant="ghost"
          >
            Usar outro e-mail
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="font-display text-2xl tracking-tight">Entrar</CardTitle>
        <CardDescription>
          Use o e-mail no qual você recebeu o convite. Vamos te enviar um link mágico.
        </CardDescription>
      </CardHeader>
      <form noValidate onSubmit={handleSubmit}>
        <CardContent>
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
        </CardContent>
        <CardFooter className="flex flex-col gap-3 pt-6">
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button
                className="w-full"
                disabled={!canSubmit || isSubmitting}
                size="lg"
                type="submit"
              >
                {isSubmitting ? "Enviando…" : "Enviar link mágico"}
              </Button>
            )}
          </form.Subscribe>
        </CardFooter>
      </form>
    </Card>
  );
};

export { LoginForm };
