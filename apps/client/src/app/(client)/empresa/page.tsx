import { PageContainer } from "@repo/ui/components/page-container";
import { Skeleton } from "@repo/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmpresaClient } from "@/components/empresa-client";
import { requireCustomer, requireSession } from "@/lib/auth-helpers";

export const metadata: Metadata = {
  title: "Minha empresa",
};

const EmpresaContent = async () => {
  const [session, me] = await Promise.all([requireSession(), requireCustomer()]);
  const companyId = me.currentOrg?.id;
  if (companyId === undefined || companyId === "") {
    throw new Error("CUSTOMER has no currentOrg; auth invariant broken");
  }

  const token = session.session.token;

  return <EmpresaClient companyId={companyId} sessionToken={token} />;
};

// Static shell for the prerender: the page is bound to the per-request
// session, so cacheComponents needs a Suspense boundary above it.
const EmpresaSkeleton = () => (
  <PageContainer aria-hidden>
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  </PageContainer>
);

const EmpresaPage = () => (
  <Suspense fallback={<EmpresaSkeleton />}>
    <EmpresaContent />
  </Suspense>
);

export default EmpresaPage;
