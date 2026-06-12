"use client";

import { toast } from "@repo/ui/lib/toast";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

// Top-level client provider. TanStack Query lives at the app root so every
// client component can read the same cache.
//
// Error toasting is centralised here: queries opt in by setting
// `meta.errorToast` to a pt-BR prefix. QueryCache.onError fires once per
// failed fetch cycle (after retries), and polling queries keep failing on
// an interval during an outage — dedupe identical consecutive errors per
// query so the user sees one toast per failure streak, not one per poll.
const Providers = ({ children }: { children: ReactNode }) => {
  const [client] = useState(() => {
    const lastToastedByQuery = new Map<string, string>();
    return new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          staleTime: 30_000,
        },
      },
      queryCache: new QueryCache({
        onError: (error, query) => {
          const prefix = query.meta?.errorToast;
          if (typeof prefix !== "string") {
            return;
          }
          if (lastToastedByQuery.get(query.queryHash) === error.message) {
            return;
          }
          lastToastedByQuery.set(query.queryHash, error.message);
          toast.error(`${prefix}: ${error.message}`);
        },
        onSuccess: (_data, query) => {
          lastToastedByQuery.delete(query.queryHash);
        },
      }),
    });
  });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

export { Providers };
