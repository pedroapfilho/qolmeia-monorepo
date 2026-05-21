import type { ReactNode } from "react";

import { Sidebar } from "@/components/sidebar";
import { requireStaff } from "@/lib/auth-helpers";

// All dashboard routes require OWNER or STAFF. requireStaff hits /api/v1/me
// on every render — the proxy already gates on session presence, so this
// covers the role-check that the proxy can't perform without DB context.
const DashboardLayout = async ({ children }: { children: ReactNode }) => {
  await requireStaff();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <main className="flex-1 px-6 py-8" id="main-content">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
