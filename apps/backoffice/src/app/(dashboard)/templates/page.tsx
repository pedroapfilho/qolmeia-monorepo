import { Card } from "@repo/ui/components/card";
import { PageHeader } from "@repo/ui/components/page-header";
import { Skeleton } from "@repo/ui/components/skeleton";
import { buttonVariants } from "@repo/ui/lib/button-variants";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { TemplatesList } from "@/components/templates-list";
import { requireStaff } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Modelos" };

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

const TemplatesContent = async () => {
  await requireStaff();
  return <TemplatesList />;
};

const TemplatesSkeleton = () => (
  <Card aria-hidden className="overflow-hidden p-0">
    <Skeleton className="h-64 w-full" />
  </Card>
);

const TemplatesPage = () => (
  <div className="flex flex-col gap-6">
    <PageHeader
      actions={
        <Link className={buttonVariants()} href="/templates/new">
          Novo modelo
        </Link>
      }
      description="O catálogo de tipos de especialista que os times podem materializar."
      title="Modelos"
    />
    <Suspense fallback={<TemplatesSkeleton />}>
      <TemplatesContent />
    </Suspense>
  </div>
);

export default TemplatesPage;
