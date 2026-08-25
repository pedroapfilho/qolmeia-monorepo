"use client";

import { useEffect, useRef } from "react";

import { log } from "@/lib/observability-client";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const styles = {
  body: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    color: "#0a0a0a",
    display: "flex",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    justifyContent: "center",
    margin: 0,
    minHeight: "100vh",
    padding: "1.5rem",
  },
  button: {
    backgroundColor: "#0a0a0a",
    border: "none",
    borderRadius: "0.5rem",
    color: "#fafafa",
    cursor: "pointer",
    fontSize: "0.875rem",
    minHeight: "2.75rem",
    padding: "0.625rem 1.25rem",
  },
  main: {
    alignItems: "center",
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem",
    maxWidth: "28rem",
    textAlign: "center",
  },
} as const;

const GlobalError = ({ error, reset }: GlobalErrorProps) => {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    log.error({ digest: error.digest, error: error.message, message: "Global error boundary" });
    headingRef.current?.focus();
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={styles.body}>
        <main id="main-content" style={styles.main}>
          <h1 ref={headingRef} tabIndex={-1}>
            Algo deu errado
          </h1>
          <p>O aplicativo parou inesperadamente. Tente novamente em instantes.</p>
          <button onClick={reset} style={styles.button} type="button">
            Tentar novamente
          </button>
        </main>
      </body>
    </html>
  );
};

export default GlobalError;
