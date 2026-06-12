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
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { registerSchema } from "@/lib/form-schemas";

import { stashCredentials } from "../verify-email/credentials-store";

const RegisterPage = () => {
  const { push, refresh } = useRouter();

  const form = useForm({
    defaultValues: { confirmPassword: "", email: "", name: "", password: "" },
    onSubmit: async ({ value }) => {
      if (value.password !== value.confirmPassword) {
        toast.error("As senhas não conferem.");
        return;
      }
      const result = await authClient.signUp.email({
        email: value.email,
        name: value.name,
        password: value.password,
      });
      if (result.error) {
        toast.error(result.error.message ?? "Não foi possível criar a conta.");
        return;
      }
      // No token means requireEmailVerification suppressed auto-sign-in (or
      // enumeration prevention returned synthetic success); both paths route
      // to /verify-email with the same "check inbox" UX.
      if (!result.data?.token) {
        const handoff = stashCredentials({ email: value.email, password: value.password });
        push(`/verify-email?k=${handoff}`);
        return;
      }
      toast.success("Conta criada. Bem-vindo à Qolmeia!");
      push("/");
      refresh();
    },
    validators: { onSubmit: registerSchema },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void form.handleSubmit();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Criar conta</CardTitle>
        <CardDescription>Cadastre-se para acessar o painel da Qolmeia.</CardDescription>
      </CardHeader>
      <form noValidate onSubmit={handleSubmit}>
        <CardContent>
          <FieldGroup>
            <form.Field name="name">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid || undefined}>
                    <FieldLabel htmlFor={field.name}>Nome</FieldLabel>
                    <Input
                      aria-invalid={isInvalid}
                      autoComplete="name"
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      type="text"
                      value={field.state.value}
                    />
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>

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

            <form.Field name="password">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid || undefined}>
                    <FieldLabel htmlFor={field.name}>Senha</FieldLabel>
                    <Input
                      aria-invalid={isInvalid}
                      autoComplete="new-password"
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
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
                    <FieldLabel htmlFor={field.name}>Confirmar senha</FieldLabel>
                    <Input
                      aria-invalid={isInvalid}
                      autoComplete="new-password"
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
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
                {isSubmitting ? "Criando conta..." : "Criar conta"}
              </Button>
            )}
          </form.Subscribe>
          <p className="text-center text-sm text-muted-foreground">
            Já tem conta?{" "}
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              href="/login"
            >
              Entrar
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
};

export default RegisterPage;
