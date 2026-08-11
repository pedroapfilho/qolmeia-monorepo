import { Skeleton } from "@repo/ui/components/skeleton";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { MemberEditForm } from "@/components/member-edit-form";
import { ApiError } from "@/lib/api-client";
import { apiGetServer } from "@/lib/api-server";
import type { TeamMemberDetailView } from "@/lib/team-fetch";

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

type Props = { params: Promise<{ companyId: string; memberId: string }> };

const MemberEditContent = async ({ params }: Props) => {
  const { companyId, memberId } = await params;

  const member = await apiGetServer<{ member: TeamMemberDetailView }>(
    `/teams/${companyId}/members/${memberId}`,
  )
    .then((body) => body.member)
    .catch((error: unknown) => {
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

const MemberEditSkeleton = () => (
  <div aria-hidden className="flex flex-col gap-6">
    <Skeleton className="h-8 w-56" />
    <Skeleton className="h-72 w-full" />
  </div>
);

const MemberEditPage = (props: Props) => (
  <Suspense fallback={<MemberEditSkeleton />}>
    <MemberEditContent {...props} />
  </Suspense>
);

export default MemberEditPage;
