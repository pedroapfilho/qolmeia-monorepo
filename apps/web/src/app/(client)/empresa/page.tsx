import { PageContainer } from "@repo/ui/components/page-container";
import { Skeleton } from "@repo/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmpresaClient } from "@/components/empresa-client";
import { apiGetServer } from "@/lib/api-server";
import { requireCustomer } from "@/lib/auth-helpers";
import type { BrandAsset, CompanyResponse } from "@/lib/company";
import type { HireableTemplate, TeamMemberView } from "@/lib/team";

export const metadata: Metadata = {
  title: "Minha empresa",
};

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

const EmpresaContent = async () => {
  const me = await requireCustomer();
  const [company, brandAssets, members, catalogue] = await Promise.allSettled([
    apiGetServer<CompanyResponse>("/api/me/company"),
    apiGetServer<{ items: Array<BrandAsset> }>("/api/me/brand-assets"),
    apiGetServer<{ members: Array<TeamMemberView> }>("/api/me/team"),
    apiGetServer<{ templates: Array<HireableTemplate> }>("/api/me/catalogue"),
  ]);

  return (
    <EmpresaClient
      companyId={me.currentOrg.id}
      initialBrandAssets={brandAssets.status === "fulfilled" ? brandAssets.value.items : undefined}
      initialCatalogue={catalogue.status === "fulfilled" ? catalogue.value.templates : undefined}
      initialCompany={company.status === "fulfilled" ? company.value : undefined}
      initialMembers={members.status === "fulfilled" ? members.value.members : undefined}
    />
  );
};

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
