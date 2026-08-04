import { Skeleton } from "@repo/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { TemplateForm } from "@/components/template-form";
import { requireStaff } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Novo modelo" };

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

const NewTemplateContent = async () => {
  await requireStaff();
  return <TemplateForm />;
};

// Static shell for the prerender: the staff gate reads the per-request
// session, so cacheComponents needs a Suspense boundary above it.
const NewTemplateSkeleton = () => (
  <div aria-hidden className="flex flex-col gap-6">
    <Skeleton className="h-8 w-48" />
    <Skeleton className="h-64 w-full" />
  </div>
);

const NewTemplatePage = () => (
  <Suspense fallback={<NewTemplateSkeleton />}>
    <NewTemplateContent />
  </Suspense>
);

export default NewTemplatePage;
