import type { ReactNode } from "react";

import { Nav } from "@/components/nav";
import { requireCustomer } from "@/lib/auth-helpers";

// Every customer route lives under this layout. requireCustomer hits
// /api/v1/me on every render — the proxy already gates on session presence,
// so this covers the role-check that the proxy can't perform without DB
// context.
const ClientLayout = async ({ children }: { children: ReactNode }) => {
  const me = await requireCustomer();
  const orgName = me.currentOrg?.name ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Nav orgName={orgName} />
      <main className="flex-1" id="main-content">
        {children}
      </main>
    </div>
  );
};

export default ClientLayout;
