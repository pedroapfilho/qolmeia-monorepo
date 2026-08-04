import { Skeleton } from "@repo/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Chat } from "@/components/chat";
import { OnboardingActions } from "@/components/onboarding-actions";
import { TeamSidebar } from "@/components/team-sidebar";
import { AGENTS_SERVER_URL } from "@/lib/agents-url";
import { requireCustomer, requireSession } from "@/lib/auth-helpers";

export const metadata: Metadata = {
  title: "Chat",
};

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "";

type CompanyResponse = {
  company: { id: string; slug: string; status: string };
};

type TemplatesResponse = {
  templates: ReadonlyArray<{
    description: string;
    displayName: string;
    id: string;
    workerKind: string;
  }>;
};

type FetchOutcome<T> = { data: T; kind: "ok" } | { kind: "missing" };

/**
 * orgId is sent explicitly so these reads land on the same org the page just
 * rendered, instead of whichever one the Worker would resolve on its own. Only
 * 404 folds into a value, because a company with no row genuinely has not been
 * onboarded. Every other refusal (403 for the wrong org, 5xx, a dead socket) is
 * raised: rendering onboarding at an onboarded customer would hide it.
 */
const fetchJson = async <T,>(
  url: string,
  token: string,
  orgId: string,
): Promise<FetchOutcome<T>> => {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "X-Org-Id": orgId },
  });
  if (res.status === 404) {
    return { kind: "missing" };
  }
  if (!res.ok) {
    throw new Error(`${url} responded ${res.status}`);
  }
  // oxlint-disable-next-line no-unsafe-type-assertion -- typed-fetch helper for first-party API routes; callers own T
  return { data: (await res.json()) as T, kind: "ok" };
};

const ChatContent = async () => {
  const [session, me] = await Promise.all([requireSession(), requireCustomer()]);
  const companyId = me.currentOrg.id;

  const token = session.session.token;
  const companyRes = await fetchJson<CompanyResponse>(
    `${AGENTS_SERVER_URL}/api/me/company`,
    token,
    companyId,
  );
  const status = companyRes.kind === "ok" ? companyRes.data.company.status : "onboarding";

  if (status === "onboarding") {
    const templatesRes = await fetchJson<TemplatesResponse>(
      `${AGENTS_SERVER_URL}/api/me/templates`,
      token,
      companyId,
    );
    return (
      <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col bg-background">
        <div className="min-h-0 flex-1 overflow-hidden">
          <Chat agent="planner" agentsUrl={AGENTS_URL} companyId={companyId} sessionToken={token} />
        </div>
        <OnboardingActions
          agentsUrl={AGENTS_URL}
          companyId={companyId}
          sessionToken={token}
          templates={templatesRes.kind === "ok" ? templatesRes.data.templates : []}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-1 bg-background">
      <div className="flex min-w-0 flex-1 flex-col">
        <Chat
          agent="correspondent"
          agentsUrl={AGENTS_URL}
          companyId={companyId}
          sessionToken={token}
        />
      </div>
      <div className="hidden lg:flex">
        <TeamSidebar companyId={companyId} sessionToken={token} />
      </div>
    </div>
  );
};

const ChatSkeleton = () => (
  <div aria-hidden className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col gap-4 bg-background p-6">
    <Skeleton className="h-6 w-40" />
    <Skeleton className="min-h-0 flex-1" />
    <Skeleton className="h-12 w-full" />
  </div>
);

// Instant navigation: the static shell streams immediately as the fallback
// while the per-user, session-bound chat renders on the server.
const ChatPage = () => (
  <Suspense fallback={<ChatSkeleton />}>
    <ChatContent />
  </Suspense>
);

export default ChatPage;
