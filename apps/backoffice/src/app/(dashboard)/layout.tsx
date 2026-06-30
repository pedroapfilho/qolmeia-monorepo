import { Skeleton } from "@repo/ui/components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Sidebar } from "@/components/sidebar";
import { apiGetServer } from "@/lib/api-server";
import type { ActionsResponse } from "@/lib/api-types";
import { requireStaff } from "@/lib/auth-helpers";

const SidebarData = async () => {
  const [me, pendingRes] = await Promise.all([
    requireStaff(),
    apiGetServer<ActionsResponse>("/actions?status=pending&sort=age").catch(() => null),
  ]);

  const pendingCount = pendingRes?.items.length ?? 0;
  const displayName = me.user.displayName ?? me.user.name ?? me.user.email;

  return (
    <Sidebar
      pendingCount={pendingCount}
      user={{ email: me.user.email, name: displayName, role: me.role }}
    />
  );
};

const SidebarSkeleton = () => (
  <aside
    aria-hidden
    className="hidden h-screen w-[238px] shrink-0 flex-col gap-2 border-r border-border bg-card px-3.5 pt-5 pb-4 md:sticky md:top-0 md:flex"
  >
    <Skeleton className="h-6 w-24" />
    <div className="mt-4 flex flex-col gap-1.5">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton className="h-8 w-full" key={index} />
      ))}
    </div>
    <Skeleton className="mt-auto h-10 w-full" />
  </aside>
);

const DashboardLayout = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen bg-background">
    {/* Instant navigation: the static sidebar shell streams immediately while the
        session-bound user and pending count resolve on the server. */}
    <Suspense fallback={<SidebarSkeleton />}>
      <SidebarData />
    </Suspense>
    <div className="flex flex-1 flex-col">
      <main className="flex-1 px-10 py-8 pb-16" id="main-content">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  </div>
);

export default DashboardLayout;
