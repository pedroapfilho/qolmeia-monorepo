import type { Metadata } from "next";

import { EmpresaClient } from "@/components/empresa-client";
import { requireCustomer, requireSession } from "@/lib/auth-helpers";

export const metadata: Metadata = {
  title: "Minha empresa",
};

/**
 * Authenticated surface bound to the per-request session and `/api/me`; the
 * page is the customer's own company, so block rather than stream a shell.
 * @public Next.js app-router reads the `instant` route config via the module loader
 */
export const instant = false;

const EmpresaPage = async () => {
  const [session, me] = await Promise.all([requireSession(), requireCustomer()]);
  const companyId = me.currentOrg?.id;
  if (!companyId) {
    throw new Error("CUSTOMER has no currentOrg — auth invariant broken");
  }

  const token = session.session.token;

  return <EmpresaClient companyId={companyId} sessionToken={token} />;
};

export default EmpresaPage;
