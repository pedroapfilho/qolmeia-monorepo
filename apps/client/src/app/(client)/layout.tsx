import { Skeleton } from "@repo/ui/components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Nav } from "@/components/nav";
import { requireCustomer } from "@/lib/auth-helpers";

const NavData = async () => {
  const me = await requireCustomer();
  return <Nav orgName={me.currentOrg?.name ?? null} />;
};

const NavSkeleton = () => (
  <div
    aria-hidden
    className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-5"
  >
    <Skeleton className="h-6 w-32" />
    <Skeleton className="size-[30px]" />
  </div>
);

const ClientLayout = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen flex-col bg-background">
    {/* Instant navigation: the static nav shell streams immediately while the
        session-bound org name resolves on the server. */}
    <Suspense fallback={<NavSkeleton />}>
      <NavData />
    </Suspense>
    <main className="flex-1" id="main-content">
      {children}
    </main>
  </div>
);

export default ClientLayout;
