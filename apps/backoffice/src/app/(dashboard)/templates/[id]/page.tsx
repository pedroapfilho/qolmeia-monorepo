import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TemplateForm } from "@/components/template-form";
import { ApiError } from "@/lib/api-client";
import { apiGetServer } from "@/lib/api-server";
import type { TemplateResponse } from "@/lib/api-types";
import { requireStaff } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Editar modelo" };

type EditTemplatePageProps = {
  params: Promise<{ id: string }>;
};

const EditTemplatePage = async ({ params }: EditTemplatePageProps) => {
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

export default EditTemplatePage;
