"use client";

import { useEffect } from "react";

import { log } from "@/lib/observability-client";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

// global-error replaces the root layout, so globals.css never loads here and Tailwind
// classes would resolve to nothing. Every rule below has to be inline. The palette is
// pinned light because the app has no dark theme: its dark tokens live only under a
// `.dark` selector that nothing ever applies, so `light-dark()` would hand a dark error
// page to a dark-OS visitor of an always-light app.
const styles = {
  body: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    color: "#0a0a0a",
    display: "flex",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
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
    fontWeight: 500,
    minHeight: "2.75rem",
    padding: "0.625rem 1.25rem",
  },
  digest: {
    color: "#71717a",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.75rem",
    margin: 0,
  },
  heading: {
    fontSize: "1.5rem",
    fontWeight: 600,
    margin: 0,
  },
  main: {
    alignItems: "center",
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem",
    maxWidth: "28rem",
    textAlign: "center",
  },
  text: {
    color: "#52525b",
    fontSize: "0.875rem",
    lineHeight: 1.6,
    margin: 0,
  },
} as const;

const GlobalError = ({ error, reset }: GlobalErrorProps) => {
  useEffect(() => {
    log.error({ digest: error.digest, error: error.message, message: "Global error boundary" });
  }, [error]);

  return (
    <html lang="pt-BR" style={{ colorScheme: "light" }}>
      <body style={styles.body}>
        <main id="main-content" style={styles.main}>
          <h1 style={styles.heading}>Algo deu errado</h1>
          <p style={styles.text}>
            O aplicativo parou de funcionar inesperadamente. Tente novamente e, se o problema
            continuar, recarregue a página ou volte em alguns minutos.
          </p>
          <button onClick={reset} style={styles.button} type="button">
            Tentar novamente
          </button>
          {error.digest !== undefined && <p style={styles.digest}>Referência: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
};

export default GlobalError;
