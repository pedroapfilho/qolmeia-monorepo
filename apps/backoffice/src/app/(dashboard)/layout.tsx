import type { ReactNode } from "react";

import { Sidebar } from "@/components/sidebar";
import { apiGetServer } from "@/lib/api-server";
import type { ActionsResponse } from "@/lib/api-types";
import { requireStaff } from "@/lib/auth-helpers";

// All dashboard routes require OWNER or STAFF. requireStaff hits /api/me
// on every render — the proxy already gates on session presence, so this
// covers the role-check that the proxy can't perform without DB context.
const DashboardLayout = async ({ children }: { children: ReactNode }) => {
  // requireStaff drives access control; the pending count only decorates the
  // sidebar badge, so allSettled keeps a transient failure from blanking the
  // whole shell.
  const [me, pendingRes] = await Promise.all([
    requireStaff(),
    apiGetServer<ActionsResponse>("/actions?status=pending&sort=age").catch(() => null),
  ]);

  const pendingCount = pendingRes?.items.length ?? 0;
  const displayName = me.user.displayName ?? me.user.name ?? me.user.email;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        pendingCount={pendingCount}
        user={{ email: me.user.email, name: displayName, role: me.role }}
      />
      <div className="flex flex-1 flex-col">
        <main className="flex-1 px-10 py-8 pb-16" id="main-content">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
