"use client";

import { Button } from "@repo/ui/components/button";
import { useEffect, useRef } from "react";

import { log } from "@/lib/observability-client";

type LandingErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const LandingError = ({ error, reset }: LandingErrorProps) => {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    log.error({ digest: error.digest, error: error.message, message: "Route error boundary" });
    headingRef.current?.focus();
  }, [error]);

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center"
      id="main-content"
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground" ref={headingRef} tabIndex={-1}>
          Algo deu errado
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Não foi possível carregar esta página. Tente novamente em instantes.
        </p>
      </div>
      <Button onClick={reset}>Tentar novamente</Button>
    </main>
  );
};

export default LandingError;
