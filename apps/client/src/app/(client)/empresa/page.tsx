import type { Metadata } from "next";

import { EmpresaClient } from "@/components/empresa-client";
import { requireCustomer, requireSession } from "@/lib/auth-helpers";

export const metadata: Metadata = {
  title: "Minha empresa",
};

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
