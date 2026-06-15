import type { Metadata } from "next";

import { Chat } from "@/components/chat";
import { OnboardingActions } from "@/components/onboarding-actions";
import { TeamSidebar } from "@/components/team-sidebar";
import { AGENTS_SERVER_URL } from "@/lib/api-server";
import { requireCustomer, requireSession } from "@/lib/auth-helpers";

export const metadata: Metadata = {
  title: "Chat",
};

// Browser-facing Worker base handed to client components. "" = same-origin:
// the chat WebSocket (/agents/*) and REST calls ride the next.config.ts
// rewrites, so auth stays first-party under portless. NEXT_PUBLIC_AGENTS_URL
// only overrides for a cross-origin prod Worker deployment.
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

const fetchJson = async <T,>(url: string, token: string): Promise<T | null> => {
  try {
    // Server-side REST call: pass the session via the Authorization header so the
    // token never lands in the request URL (and thus never in Workers Logs).
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  }
};

const ChatPage = async () => {
  const [session, me] = await Promise.all([requireSession(), requireCustomer()]);
  const companyId = me.currentOrg?.id;
  if (!companyId) {
    throw new Error("CUSTOMER has no currentOrg — auth invariant broken");
  }

  const token = session.session.token;
  const companyRes = await fetchJson<CompanyResponse>(`${AGENTS_SERVER_URL}/api/me/company`, token);
  const status = companyRes?.company.status ?? "onboarding";

  if (status === "onboarding") {
    const templatesRes = await fetchJson<TemplatesResponse>(
      `${AGENTS_SERVER_URL}/api/me/templates`,
      token,
    );
    return (
      <div className="flex h-[calc(100vh-3.5rem)] flex-col">
        <div className="flex-1 overflow-hidden">
          <Chat agent="planner" agentsUrl={AGENTS_URL} companyId={companyId} sessionToken={token} />
        </div>
        <OnboardingActions
          agentsUrl={AGENTS_URL}
          companyId={companyId}
          sessionToken={token}
          templates={templatesRes?.templates ?? []}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-1">
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

export default ChatPage;
