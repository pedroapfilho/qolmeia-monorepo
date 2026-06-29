import { ApiError } from "@/lib/api-client";
import { AGENTS_SERVER_URL } from "@/lib/api-server";

type AgentDisplayStatus = "available" | "awaiting_approval" | "paused" | "working";

type OpenTicketSlim = {
  status: "awaiting_approval" | "in_progress";
  summary: string;
  ticketId: string;
};

type TeamMemberBase = {
  currentWork: ReadonlyArray<OpenTicketSlim>;
  displayName: string;
  hasPromptOverride: boolean;
  id: string;
  lifetimeDone: number;
  status: AgentDisplayStatus;
};

type TeamMemberNonWorker = TeamMemberBase & {
  role: "correspondent" | "planner";
  templateId: null;
  workerKind: null;
};

type TeamMemberWorker = TeamMemberBase & {
  role: "worker";
  templateId: string;
  workerKind: string;
};

type TeamMemberView = TeamMemberNonWorker | TeamMemberWorker;

type TeamMemberDetailView = TeamMemberView & {
  capabilities: string;
  companyName: string;
  createdAt: number;
  promptOverride: string | null;
  promptOverrideUpdatedAt: number | null;
  templateSystemPrompt: string;
};

type CompanyStatus = "active" | "onboarding" | "paused";

type CompanyOverview = {
  briefPercent: number;
  id: string;
  members: ReadonlyArray<TeamMemberView>;
  name: string;
  status: CompanyStatus;
};

const fetchMember = async (
  companyId: string,
  memberId: string,
  cookie: string,
): Promise<TeamMemberDetailView> => {
  const res = await fetch(
    `${AGENTS_SERVER_URL}/api/backoffice/teams/${companyId}/members/${memberId}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return ((await res.json()) as { member: TeamMemberDetailView }).member;
};

const fetchCompanies = async (cookie: string): Promise<Array<CompanyOverview>> => {
  const res = await fetch(`${AGENTS_SERVER_URL}/api/backoffice/companies`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return ((await res.json()) as { companies: Array<CompanyOverview> }).companies;
};

export { fetchCompanies, fetchMember };
export type {
  AgentDisplayStatus,
  CompanyOverview,
  CompanyStatus,
  OpenTicketSlim,
  TeamMemberBase,
  TeamMemberDetailView,
  TeamMemberNonWorker,
  TeamMemberView,
  TeamMemberWorker,
};
