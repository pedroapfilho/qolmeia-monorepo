"use client";

import { authClient } from "@repo/app-shell/auth-client";
import { Button } from "@repo/ui/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/lib/toast";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { loginSchema, magicLinkSchema } from "@/lib/form-schemas";

type LoginFormDependencies = {
  sendMagicLink: (input: {
    callbackURL: string;
    email: string;
  }) => Promise<{ error: { message?: string } | null }>;
  showError: (message: string) => void;
  signInEmail: (credentials: {
    email: string;
    password: string;
  }) => Promise<{ error: { message?: string } | null }>;
  useAppRouter: () => Pick<ReturnType<typeof useRouter>, "push" | "refresh">;
};

const createLoginForm = ({
  sendMagicLink,
  showError,
  signInEmail,
  useAppRouter,
}: LoginFormDependencies) => {
  const LoginFormWithDependencies = () => {
    const { push, refresh } = useAppRouter();
    const [isSendingMagicLink, startSendingMagicLink] = useTransition();
    const [sent, setSent] = useState(false);

    const form = useForm({
      defaultValues: { email: "", password: "" },
      onSubmit: async ({ value }) => {
        try {
          const { error } = await signInEmail({
            email: value.email,
            password: value.password,
          });
          if (error) {
            showError("Não foi possível entrar. Verifique seu e-mail e sua senha.");
            return;
          }
        } catch {
          showError("Não foi possível conectar ao servidor. Tente novamente.");
          return;
        }
        push("/");
        refresh();
      },
      validators: { onSubmit: loginSchema },
    });

    const handleMagicLink = () => {
      const result = magicLinkSchema.safeParse({ email: form.state.values.email });
      if (!result.success) {
        showError(result.error.issues[0]?.message ?? "E-mail inválido");
        return;
      }

      const callbackURL = `${window.location.origin}/auth/verify`;
      startSendingMagicLink(async () => {
        try {
          const { error } = await sendMagicLink({ callbackURL, email: result.data.email });
          if (error) {
            showError(error.message ?? "Não foi possível enviar o link. Tente novamente.");
            return;
          }
          setSent(true);
        } catch {
          showError("Não foi possível conectar ao servidor. Tente novamente.");
        }
      });
    };

    const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void form.handleSubmit();
    };

    if (sent) {
      return (
        <div className="w-full max-w-xs">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Verifique seu e-mail
          </h2>
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
          Use o e-mail no qual você recebeu o convite e sua senha para entrar.
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

            <form.Field name="password">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid || undefined}>
                    <FieldLabel htmlFor={field.name}>Senha</FieldLabel>
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
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <div className="mt-6 flex flex-col gap-3">
                <Button
                  className="w-full"
                  disabled={!canSubmit || isSubmitting || isSendingMagicLink}
                  size="lg"
                  type="submit"
                >
                  {isSubmitting ? "Entrando…" : "Entrar"}
                </Button>
                <Button
                  className="w-full"
                  disabled={isSubmitting || isSendingMagicLink}
                  onClick={handleMagicLink}
                  size="lg"
                  type="button"
                  variant="outline"
                >
                  {isSendingMagicLink ? "Enviando…" : "Enviar link mágico"}
                </Button>
              </div>
            )}
          </form.Subscribe>
        </form>
      </div>
    );
  };

  return LoginFormWithDependencies;
};

const LoginForm = createLoginForm({
  sendMagicLink: async (input) => {
    const { error } = await authClient.signIn.magicLink(input);
    return { error };
  },
  showError: (message) => {
    toast.error(message);
  },
  signInEmail: async (credentials) => {
    const { error } = await authClient.signIn.email(credentials);
    return { error };
  },
  useAppRouter: useRouter,
});

export { createLoginForm, LoginForm };
export type { LoginFormDependencies };
