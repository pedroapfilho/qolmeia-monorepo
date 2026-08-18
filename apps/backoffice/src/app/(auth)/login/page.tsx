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
import { Suspense, use, useState } from "react";

import { loginSchema } from "@/lib/form-schemas";
import { safeRedirectPath } from "@/lib/redirect-validation";

type Props = {
  searchParams: Promise<{ from?: string }>;
};

type LoginDependencies = {
  showError: (message: string) => void;
  signInEmail: (credentials: {
    email: string;
    password: string;
  }) => Promise<{ error: { code?: string; message?: string } | null }>;
  useAppRouter: () => Pick<ReturnType<typeof useRouter>, "push" | "refresh">;
};

const RegisterLinkFallback = () => (
  <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/register">
    Criar conta
  </Link>
);

const RegisterLink = ({ searchParams }: Props) => {
  const { from } = use(searchParams);
  const redirectTo = safeRedirectPath(from);

  return (
    <Link
      className="font-medium text-primary underline-offset-4 hover:underline"
      href={redirectTo === "/" ? "/register" : `/register?from=${encodeURIComponent(redirectTo)}`}
    >
      Criar conta
    </Link>
  );
};

const createLoginPage = ({ showError, signInEmail, useAppRouter }: LoginDependencies) => {
  const LoginForm = ({ searchParams }: Props) => {
    const { push, refresh } = useAppRouter();
    const [showUnverifiedNotice, setShowUnverifiedNotice] = useState(false);

    const form = useForm({
      defaultValues: { email: "", password: "" },
      onSubmit: async ({ value }) => {
        setShowUnverifiedNotice(false);
        try {
          const { error } = await signInEmail({
            email: value.email,
            password: value.password,
          });
          if (error) {
            if (error.code === "EMAIL_NOT_VERIFIED") {
              setShowUnverifiedNotice(true);
              return;
            }
            showError(error.message ?? "Não foi possível entrar. Verifique seus dados.");
            return;
          }
        } catch {
          showError("Não foi possível conectar ao servidor. Tente novamente.");
          return;
        }
        const { from } = await searchParams;
        push(safeRedirectPath(from));
        refresh();
      },
      validators: { onSubmit: loginSchema },
    });

    const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void form.handleSubmit();
    };

    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Entrar</CardTitle>
          <CardDescription>Acesse o painel operacional da Qolmeia.</CardDescription>
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

              <form.Field name="password">
                {(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid || undefined}>
                      <div className="flex items-center justify-between">
                        <FieldLabel htmlFor={field.name}>Senha</FieldLabel>
                        <Link
                          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                          href="/recover"
                        >
                          Esqueci minha senha
                        </Link>
                      </div>
                      <Input
                        aria-invalid={isInvalid}
                        autoComplete="current-password"
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

            {showUnverifiedNotice && (
              <output aria-live="polite" className="mt-4 block text-center text-sm">
                Este e-mail ainda não foi verificado. Acabamos de enviar um novo link.
              </output>
            )}
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
                  {isSubmitting ? "Entrando…" : "Entrar"}
                </Button>
              )}
            </form.Subscribe>
            <p className="text-center text-sm text-muted-foreground">
              Ainda não tem conta?{" "}
              <Suspense fallback={<RegisterLinkFallback />}>
                <RegisterLink searchParams={searchParams} />
              </Suspense>
            </p>
          </CardFooter>
        </form>
      </Card>
    );
  };

  return LoginForm;
};

const LoginPage = createLoginPage({
  showError: (message) => {
    toast.error(message);
  },
  signInEmail: async (credentials) => {
    const { error } = await authClient.signIn.email(credentials);
    return { error };
  },
  useAppRouter: useRouter,
});

export default LoginPage;
export { createLoginPage };
export type { LoginDependencies };
