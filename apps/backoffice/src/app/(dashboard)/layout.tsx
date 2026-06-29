import type { ReactNode } from "react";

import { Sidebar } from "@/components/sidebar";
import { apiGetServer } from "@/lib/api-server";
import type { ActionsResponse } from "@/lib/api-types";
import { requireStaff } from "@/lib/auth-helpers";

const DashboardLayout = async ({ children }: { children: ReactNode }) => {
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
