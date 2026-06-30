import type { Metadata } from "next";

import { TemplatesList } from "@/components/templates-list";
import { requireStaff } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Modelos" };

/**
 * Authenticated operator surface bound to the per-request session cookie; block
 * rather than stream so each request reads fresh data.
 * @public Next.js app-router reads the `instant` route config via the module loader
 */
export const instant = false;

const TemplatesPage = async () => {
  await requireStaff();
  return <TemplatesList />;
};

export default TemplatesPage;
