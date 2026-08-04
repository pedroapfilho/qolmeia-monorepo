import { Skeleton } from "@repo/ui/components/skeleton";
import type { TemplateResponse } from "@repo/worker-api/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { TemplateForm } from "@/components/template-form";
import { ApiError } from "@/lib/api-client";
import { apiGetServer } from "@/lib/api-server";
import { requireStaff } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Editar modelo" };

type EditTemplatePageProps = {
  params: Promise<{ id: string }>;
};

const EditTemplateContent = async ({ params }: EditTemplatePageProps) => {
  await requireStaff();
  const { id } = await params;

  let detail: TemplateResponse | null = null;
  try {
    detail = await apiGetServer<TemplateResponse>(`/templates/${id}`);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error;
    }
  }
  if (!detail) {
    notFound();
  }

  return <TemplateForm initial={detail.template} />;
};

// Static shell for the prerender: the form is bound to `params` and the
// per-request session, so cacheComponents needs a Suspense boundary above it.
const EditTemplateSkeleton = () => (
  <div aria-hidden className="flex flex-col gap-6">
    <Skeleton className="h-8 w-48" />
    <Skeleton className="h-64 w-full" />
  </div>
);

const EditTemplatePage = (props: EditTemplatePageProps) => (
  <Suspense fallback={<EditTemplateSkeleton />}>
    <EditTemplateContent {...props} />
  </Suspense>
);

export default EditTemplatePage;
