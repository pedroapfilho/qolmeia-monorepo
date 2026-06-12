import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { MemberEditForm } from "@/components/member-edit-form";
import { ApiError } from "@/lib/api-client";
import { fetchMember } from "@/lib/team-fetch";

type Props = { params: Promise<{ companyId: string; memberId: string }> };

// Server Component: the member detail is server data (same pattern as
// teams/page.tsx with fetchTeam). The client form owns the edits.
const MemberEditPage = async ({ params }: Props) => {
  // params and headers() don't depend on each other — resolve them together.
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
    /* MemberEditForm seeds local form state from `initialMember`; keying by
       memberId remounts it when the route's member changes (App Router reuses
       the client component across dynamic-param navigations), so member B
       never renders — or PATCHes — member A's stale form state. */
    <MemberEditForm
      companyId={companyId}
      initialMember={member}
      key={memberId}
      memberId={memberId}
    />
  );
};

export default MemberEditPage;
