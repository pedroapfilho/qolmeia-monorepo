"use client";

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
import Link from "next/link";

import { authClient } from "@/lib/auth-client";
import { recoverSchema } from "@/lib/form-schemas";

const RecoverPage = () => {
  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      try {
        const { error } = await authClient.requestPasswordReset({
          email: value.email,
          redirectTo: "/reset-password",
        });
        if (error) {
          toast.error(error.message ?? "Não foi possível enviar o link.");
          return;
        }
      } catch {
        // Better Auth's client returns { error } for HTTP failures but THROWS
        // on network failures — catch so it doesn't escape the submit as an
        // unhandledRejection.
        toast.error("Não foi possível conectar ao servidor — tente novamente.");
        return;
      }
      toast.success("Enviamos um link para seu e-mail.");
    },
    validators: { onSubmit: recoverSchema },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void form.handleSubmit();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Recuperar senha</CardTitle>
        <CardDescription>
          Informe o e-mail cadastrado para receber o link de redefinição.
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
                      onChange={(event) => field.handleChange(event.target.value)}
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
                {isSubmitting ? "Enviando..." : "Enviar link"}
              </Button>
            )}
          </form.Subscribe>
          <p className="text-center text-sm text-muted-foreground">
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              href="/login"
            >
              Voltar para o login
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
};

export default RecoverPage;
