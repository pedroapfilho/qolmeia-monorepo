"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

// Top-level client provider. TanStack Query lives at the app root so every
// client component can read the same cache. Defaults err on the side of
// fewer refetches — backoffice data is rarely stale-sensitive and the API
// is cookie-authed, so refetch-on-focus would just generate noise.
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
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

export { Providers };
