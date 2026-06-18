// Backoffice-side fetchers. Same shapes as the customer side; different
// endpoint prefix.

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

const fetchTeam = async (companyId: string, cookie: string): Promise<Array<TeamMemberView>> => {
  const res = await fetch(`${AGENTS_SERVER_URL}/api/backoffice/teams/${companyId}/members`, {
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
  return ((await res.json()) as { members: Array<TeamMemberView> }).members;
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

// Operator-wide overview: every company + its roster. Spans tenants (the back
// office is Qolmeia staff), gated server-side by the OWNER/STAFF check.
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

// fallow-ignore-next-line unused-export
export { fetchCompanies, fetchMember, fetchTeam };
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
