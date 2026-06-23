import type { Metadata } from "next";

import { TemplateForm } from "@/components/template-form";
import { requireStaff } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Novo modelo" };

const NewTemplatePage = async () => {
  await requireStaff();
  return <TemplateForm />;
};

export default NewTemplatePage;
