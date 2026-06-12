"use client";

import { toast } from "@repo/ui/lib/toast";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

// Top-level client provider. TanStack Query lives at the app root so every
// client component can read the same cache.
//
// Error toasting is centralised here: queries opt in by setting
// `meta.errorToast` to a pt-BR prefix. QueryCache.onError fires once per
// failed fetch cycle (after retries), so no per-component dedupe is needed.
const Providers = ({ children }: { children: ReactNode }) => {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 30_000,
          },
        },
        queryCache: new QueryCache({
          onError: (error, query) => {
            const prefix = query.meta?.errorToast;
            if (typeof prefix === "string") {
              toast.error(`${prefix}: ${error.message}`);
            }
          },
        }),
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

export { Providers };
