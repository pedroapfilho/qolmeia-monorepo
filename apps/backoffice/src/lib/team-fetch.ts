// apps/backoffice/src/lib/team-fetch.ts
// Backoffice-side fetchers. Same shapes as the customer side; different
// endpoint prefix.

import { AGENTS_URL, ApiError } from "@/lib/api-client";

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

const fetchTeam = async (companyId: string, cookie: string): Promise<Array<TeamMemberView>> => {
  const res = await fetch(`${AGENTS_URL}/api/backoffice/teams/${companyId}/members`, {
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

export { fetchTeam };
export type {
  AgentDisplayStatus,
  OpenTicketSlim,
  TeamMemberBase,
  TeamMemberNonWorker,
  TeamMemberView,
  TeamMemberWorker,
};
