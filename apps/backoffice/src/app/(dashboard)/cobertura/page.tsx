import { Card } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";

import { CoverageForm } from "@/components/coverage-form";
import { apiGetServer } from "@/lib/api-server";
import type { CoverageResponse } from "@/lib/api-types";

export const metadata: Metadata = { title: "Cobertura" };

/**
 * Authenticated operator surface bound to the per-request session cookie; block
 * rather than stream so each request reads fresh data.
 * @public Next.js app-router reads the `instant` route config via the module loader
 */
export const instant = false;

const CoveragePage = async () => {
  const coverage = await apiGetServer<CoverageResponse>("/assignments/me").catch(() => null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Escolha as empresas e disciplinas que você revisa. A fila de aprovações passa a mostrar só o que está sob sua cobertura — sem nada marcado, você vê tudo."
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

export default CoveragePage;
