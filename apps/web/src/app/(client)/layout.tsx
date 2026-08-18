import { Skeleton } from "@repo/ui/components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Nav } from "@/components/nav";
import { requireCustomer } from "@/lib/auth-helpers";

const NavData = async () => {
  const me = await requireCustomer();
  return <Nav orgName={me.currentOrg.name} />;
};

const NavSkeleton = () => (
  <div
    aria-hidden
    className="sticky top-0 z-10 flex h-24 shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-4 pt-4 md:h-14 md:items-center md:px-5 md:pt-0"
  >
    <Skeleton className="h-6 w-32" />
    <Skeleton className="size-[30px]" />
  </div>
);

const ClientLayout = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-svh flex-col bg-background">
    <Suspense fallback={<NavSkeleton />}>
      <NavData />
    </Suspense>
    <div className="flex-1">{children}</div>
  </div>
);

export default ClientLayout;
