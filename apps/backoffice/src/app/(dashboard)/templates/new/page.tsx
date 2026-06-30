import type { Metadata } from "next";

import { TemplateForm } from "@/components/template-form";
import { requireStaff } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Novo modelo" };

/**
 * Authenticated operator surface bound to the per-request session cookie; block
 * rather than stream so each request reads fresh data.
 * @public Next.js app-router reads the `instant` route config via the module loader
 */
export const instant = false;

const NewTemplatePage = async () => {
  await requireStaff();
  return <TemplateForm />;
};

export default NewTemplatePage;
