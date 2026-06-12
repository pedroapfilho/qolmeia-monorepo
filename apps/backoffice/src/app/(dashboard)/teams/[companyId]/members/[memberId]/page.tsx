import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { MemberEditForm } from "@/components/member-edit-form";
import { ApiError } from "@/lib/api-client";
import { fetchMember } from "@/lib/team-fetch";

type Props = { params: Promise<{ companyId: string; memberId: string }> };

// Server Component: the member detail is server data (same pattern as
// teams/page.tsx with fetchTeam). The client form owns the edits.
const MemberEditPage = async ({ params }: Props) => {
  const { companyId, memberId } = await params;
  const headersList = await headers();
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

  return <MemberEditForm companyId={companyId} initialMember={member} memberId={memberId} />;
};

export default MemberEditPage;
