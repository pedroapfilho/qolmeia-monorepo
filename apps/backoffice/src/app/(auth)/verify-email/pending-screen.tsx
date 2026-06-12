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
import { buttonVariants } from "@repo/ui/lib/button-variants";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";

import { consumeCredentials } from "./credentials-store";

const POLL_INTERVAL_MS = 5000;
const RESEND_COOLDOWN_SECONDS = 60;

type Props = {
  token: string | null;
};

type Credentials = {
  email: string;
  password: string;
};

const PendingScreen = ({ token }: Props) => {
  const router = useRouter();
  // useMemo so HMR / strict-mode double-mount doesn't burn the one-shot token.
  // The store itself is idempotent on the second read (returns null), and the
  // mounted component holds the value for the rest of its lifetime.
  const initialCredentials = useMemo<Credentials | null>(
    () => (token ? consumeCredentials(token) : null),
    [token],
  );
  const [credentials] = useState<Credentials | null>(initialCredentials);
  const [cooldown, setCooldown] = useState(0);
  const [isResending, setIsResending] = useState(false);

  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Pause polling when the tab is hidden so backgrounded tabs don't hammer the auth endpoint.
  useEffect(() => {
    if (!credentials) {
      return;
    }
    const { email, password } = credentials;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) {
        return;
      }
      if (document.visibilityState !== "visible") {
        timer = setTimeout(() => {
          void tick();
        }, POLL_INTERVAL_MS);
        return;
      }
      const result = await authClient.signIn.email({ email, password });
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (!result.error && result.data) {
        // oxlint-disable-next-line react-doctor/nextjs-no-client-side-redirect -- poll-driven navigation after email verification; no server redirect possible
        router.push("/");
        router.refresh();
        return;
      }
      timer = setTimeout(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    };

    const handleVisibilityChange = () => {
      if (cancelled || document.visibilityState !== "visible") {
        return;
      }
      void tick();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void tick();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [credentials, router]);

  // Resend cooldown — ticks down each second after a successful resend.
  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const id = setTimeout(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => {
      clearTimeout(id);
    };
  }, [cooldown]);

  const handleResend = useCallback(async () => {
    if (!credentials || cooldown > 0 || isResending) {
      return;
    }
    setIsResending(true);
    try {
      // Absolute callback — auth lives on its own origin (apps/auth), so a
      // relative URL would resolve against the auth service, not this app.
      await authClient.sendVerificationEmail({
        callbackURL: `${window.location.origin}/verify-email/success`,
        email: credentials.email,
      });
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } finally {
      setIsResending(false);
    }
  }, [cooldown, credentials, isResending]);

  if (!credentials) {
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Verificando seu e-mail</CardTitle>
          <CardDescription>
            Clique no link de verificação que enviamos para sua caixa de entrada. Depois, entre para
            continuar.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-2">
          <Link className={buttonVariants({ className: "w-full" })} href="/login">
            Entrar
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Confira sua caixa de entrada</CardTitle>
        <CardDescription>
          Enviamos um link de verificação para{" "}
          <span className="font-medium text-foreground">{credentials.email}</span>. Clique nele para
          concluir o cadastro — esta página continua automaticamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center text-sm text-muted-foreground">
        Não recebeu? Confira o spam ou reenvie abaixo.
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button
          className="w-full"
          disabled={cooldown > 0 || isResending}
          onClick={() => {
            void handleResend();
          }}
          type="button"
          variant="outline"
        >
          {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar e-mail de verificação"}
        </Button>
        <Link
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          href="/register"
        >
          Usar outro e-mail
        </Link>
      </CardFooter>
    </Card>
  );
};

export default PendingScreen;
