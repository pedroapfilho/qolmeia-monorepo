"use client";

import { toast } from "@repo/ui/lib/toast";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

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
