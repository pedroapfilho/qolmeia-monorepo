import type { Metadata } from "next";

import { Chat } from "@/components/chat";
import { OnboardingActions } from "@/components/onboarding-actions";
import { requireCustomer, requireSession } from "@/lib/auth-helpers";

export const metadata: Metadata = {
  title: "Chat",
};

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "http://localhost:8787";

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
    const res = await fetch(`${url}?cf_session=${token}`);
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  }
};

const ChatPage = async () => {
  const session = await requireSession();
  const me = await requireCustomer();
  const companyId = me.currentOrg?.id;
  if (!companyId) {
    throw new Error("CUSTOMER has no currentOrg — auth invariant broken");
  }

  const token = session.session.token;
  const companyRes = await fetchJson<CompanyResponse>(`${AGENTS_URL}/api/me/company`, token);
  const status = companyRes?.company.status ?? "onboarding";

  if (status === "onboarding") {
    const templatesRes = await fetchJson<TemplatesResponse>(
      `${AGENTS_URL}/api/me/templates`,
      token,
    );
    return (
      <div className="flex h-[calc(100vh-3.5rem)] flex-col">
        <div className="flex-1 overflow-hidden">
          <Chat
            agent="planner"
            agentsUrl={AGENTS_URL}
            companyId={companyId}
            sessionToken={token}
          />
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
    <Chat
      agent="correspondent"
      agentsUrl={AGENTS_URL}
      companyId={companyId}
      sessionToken={token}
    />
  );
};

export default ChatPage;
