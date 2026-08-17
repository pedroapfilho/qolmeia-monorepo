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
import Link from "next/link";
import { useRouter } from "next/navigation";

import { resetPasswordSchema } from "@/lib/form-schemas";

type Props = {
  searchParams: Promise<{ token?: string }>;
};

const ResetPasswordForm = ({ searchParams }: Props) => {
  const { push } = useRouter();

  const form = useForm({
    defaultValues: { confirmPassword: "", password: "" },
    onSubmit: async ({ value }) => {
      if (value.password !== value.confirmPassword) {
        toast.error("As senhas não conferem.");
        return;
      }
      const { token } = await searchParams;
      if (token === undefined || token === "") {
        toast.error("Link inválido ou expirado. Solicite um novo.");
        return;
      }
      try {
        const { error } = await authClient.resetPassword({
          newPassword: value.password,
          token,
        });
        if (error) {
          toast.error(error.message ?? "Não foi possível redefinir a senha.");
          return;
        }
      } catch {
        toast.error("Não foi possível conectar ao servidor. Tente novamente.");
        return;
      }
      toast.success("Senha redefinida com sucesso.");
      push("/login");
    },
    validators: { onSubmit: resetPasswordSchema },
  });

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void form.handleSubmit();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Redefinir senha</CardTitle>
        <CardDescription>Crie uma nova senha para sua conta.</CardDescription>
      </CardHeader>
      <form noValidate onSubmit={handleSubmit}>
        <CardContent>
          <FieldGroup>
            <form.Field name="password">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid || undefined}>
                    <FieldLabel htmlFor={field.name}>Nova senha</FieldLabel>
                    <Input
                      aria-invalid={isInvalid}
                      autoComplete="new-password"
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      type="password"
                      value={field.state.value}
                    />
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="confirmPassword">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid || undefined}>
                    <FieldLabel htmlFor={field.name}>Confirmar nova senha</FieldLabel>
                    <Input
                      aria-invalid={isInvalid}
                      autoComplete="new-password"
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      type="password"
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
                {isSubmitting ? "Salvando…" : "Redefinir senha"}
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

const ResetPasswordPage = ({ searchParams }: Props) => (
  <ResetPasswordForm searchParams={searchParams} />
);

export default ResetPasswordPage;
