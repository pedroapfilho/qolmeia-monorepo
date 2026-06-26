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
  promptOverride: string | null;
  promptOverrideUpdatedAt: number | null;
  templateSystemPrompt: string;
};

type HireableTemplate = {
  description: string;
  displayName: string;
  hiredCount: number;
  id: string;
  workerKind: string;
};

const STATUS_LABEL: Record<AgentDisplayStatus, string> = {
  available: "Disponível",
  awaiting_approval: "Aguardando aprovação",
  paused: "Pausado",
  working: "Trabalhando",
};

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "";

const apiUrl = (path: string): string => `${AGENTS_URL}${path}`;

const fetchTeam = async (): Promise<Array<TeamMemberView>> => {
  const res = await fetch(apiUrl("/api/me/team"), { credentials: "include" });
  if (!res.ok) {
    throw new Error(`GET /api/me/team failed (${res.status})`);
  }
  const body = (await res.json()) as { members: Array<TeamMemberView> };
  return body.members;
};

const fetchCatalogue = async (): Promise<Array<HireableTemplate>> => {
  const res = await fetch(apiUrl("/api/me/catalogue"), { credentials: "include" });
  if (!res.ok) {
    throw new Error(`GET /api/me/catalogue failed (${res.status})`);
  }
  const body = (await res.json()) as { templates: Array<HireableTemplate> };
  return body.templates;
};

const hireMember = async (input: {
  displayName?: string;
  templateId: string;
}): Promise<TeamMemberView> => {
  const res = await fetch(apiUrl("/api/me/team/hire"), {
    body: JSON.stringify(input),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`POST /api/me/team/hire failed (${res.status})`);
  }
  const body = (await res.json()) as { member: TeamMemberView };
  return body.member;
};

const patchMember = async (
  id: string,
  patch: { displayName?: string; promptOverride?: string | null },
): Promise<TeamMemberView> => {
  const res = await fetch(apiUrl(`/api/me/team/members/${id}`), {
    body: JSON.stringify(patch),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  if (!res.ok) {
    throw new Error(`PATCH /api/me/team/members/${id} failed (${res.status})`);
  }
  return ((await res.json()) as { member: TeamMemberView }).member;
};

const setPaused = async (id: string, paused: boolean): Promise<TeamMemberView> => {
  const res = await fetch(apiUrl(`/api/me/team/members/${id}/${paused ? "pause" : "resume"}`), {
    credentials: "include",
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`pause/resume failed (${res.status})`);
  }
  return ((await res.json()) as { member: TeamMemberView }).member;
};

export { fetchCatalogue, fetchTeam, hireMember, patchMember, setPaused, STATUS_LABEL };
export type {
  AgentDisplayStatus,
  HireableTemplate,
  OpenTicketSlim,
  TeamMemberBase,
  TeamMemberDetailView,
  TeamMemberNonWorker,
  TeamMemberView,
  TeamMemberWorker,
};
