import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { MemberEditForm } from "@/components/member-edit-form";
import { ApiError } from "@/lib/api-client";
import { fetchMember } from "@/lib/team-fetch";

type Props = { params: Promise<{ companyId: string; memberId: string }> };

const MemberEditPage = async ({ params }: Props) => {
  const [{ companyId, memberId }, headersList] = await Promise.all([params, headers()]);
  const cookie = headersList.get("cookie") ?? "";

  const member = await fetchMember(companyId, memberId, cookie).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  });
  if (!member) {
    notFound();
  }

  return (
    <MemberEditForm
      companyId={companyId}
      initialMember={member}
      key={memberId}
      memberId={memberId}
    />
  );
};

export default MemberEditPage;
