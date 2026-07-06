import { Skeleton } from "@repo/ui/components/skeleton";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { MemberEditForm } from "@/components/member-edit-form";
import { ApiError } from "@/lib/api-client";
import { fetchMember } from "@/lib/team-fetch";

type Props = { params: Promise<{ companyId: string; memberId: string }> };

const MemberEditContent = async ({ params }: Props) => {
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

// Static shell for the prerender: the form is bound to `params` and the
// per-request session, so cacheComponents needs a Suspense boundary above it.
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
