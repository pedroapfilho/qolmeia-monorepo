"use client";

import { Button } from "@repo/ui/components/button";
import { useEffect, useRef } from "react";

import { log } from "@/lib/observability-client";

type DashboardErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const DashboardError = ({ error, reset }: DashboardErrorProps) => {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    log.error({ digest: error.digest, error: error.message, message: "Route error boundary" });
    headingRef.current?.focus();
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground" ref={headingRef} tabIndex={-1}>
          Não foi possível carregar o painel
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          O serviço de autenticação pode ter ficado indisponível por um instante. Tente novamente em
          instantes.
        </p>
      </div>
      <Button
        onClick={() => {
          reset();
        }}
      >
        Tentar novamente
      </Button>
    </div>
  );
};

export default DashboardError;
