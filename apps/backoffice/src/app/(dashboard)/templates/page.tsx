import type { Metadata } from "next";

import { TemplatesList } from "@/components/templates-list";
import { requireStaff } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Modelos" };

const TemplatesPage = async () => {
  await requireStaff();
  return <TemplatesList />;
};

export default TemplatesPage;
