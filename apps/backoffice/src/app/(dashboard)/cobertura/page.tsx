import { Card } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { Skeleton } from "@repo/ui/components/skeleton";
import type { CoverageResponse } from "@repo/worker-api/contracts";
import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { CoverageForm } from "@/components/coverage-form";
import { apiGetServer } from "@/lib/api-server";

export const metadata: Metadata = { title: "Cobertura" };

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

const CoverageContent = async () => {
  const coverage = await apiGetServer<CoverageResponse>("/assignments/me").catch(() => null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Escolha as empresas e disciplinas que você revisa. A fila de aprovações passa a mostrar só o que está sob sua cobertura; sem nada marcado, você vê tudo."
        title="Minha cobertura"
      />

      <Card className="max-w-2xl p-6">
        {coverage ? (
          <CoverageForm initial={coverage.assigned} options={coverage.options} />
        ) : (
          <EmptyState
            className="py-10"
            description="Não foi possível carregar sua cobertura. Recarregue a página."
            icon={<TriangleAlert aria-hidden />}
            title="Falha ao carregar"
          />
        )}
      </Card>
    </div>
  );
};

// Static shell for the prerender: the form is bound to the per-request
// session cookie, so cacheComponents needs a Suspense boundary above it.
const CoverageSkeleton = () => (
  <div aria-hidden className="flex flex-col gap-6">
    <PageHeader
      description="Escolha as empresas e disciplinas que você revisa. A fila de aprovações passa a mostrar só o que está sob sua cobertura; sem nada marcado, você vê tudo."
      title="Minha cobertura"
    />
    <Card className="max-w-2xl p-6">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </Card>
  </div>
);

const CoveragePage = () => (
  <Suspense fallback={<CoverageSkeleton />}>
    <CoverageContent />
  </Suspense>
);

export default CoveragePage;
