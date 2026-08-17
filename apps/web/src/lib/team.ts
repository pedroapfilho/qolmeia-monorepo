import { activeOrgId, apiUrl, jsonInit, request } from "@/lib/request";

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

const fetchTeam = async (): Promise<Array<TeamMemberView>> => {
  const body = await request<{ members: Array<TeamMemberView> }>(
    "/api/me/team",
    "GET /api/me/team",
  );
  return body.members;
};

type SharedTeamEvents = {
  listeners: Set<() => void>;
  opening: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  source: EventSource | null;
};

const sharedTeamEvents: SharedTeamEvents = {
  listeners: new Set(),
  opening: false,
  reconnectTimer: null,
  source: null,
};

const RECONNECT_MS = 2000;

const notifyTeamEventListeners = (): void => {
  for (const listener of sharedTeamEvents.listeners) {
    listener();
  }
};

const closeSharedSource = (): void => {
  if (sharedTeamEvents.reconnectTimer !== null) {
    clearTimeout(sharedTeamEvents.reconnectTimer);
    sharedTeamEvents.reconnectTimer = null;
  }
  if (sharedTeamEvents.source) {
    sharedTeamEvents.source.close();
    sharedTeamEvents.source = null;
  }
};

const openSharedSource = async (): Promise<void> => {
  if (typeof EventSource === "undefined" || sharedTeamEvents.source || sharedTeamEvents.opening) {
    return;
  }
  sharedTeamEvents.opening = true;
  let orgId: string | null = null;
  try {
    orgId = await activeOrgId();
  } catch {
    // The roster query runs the same discovery and raises this to the user, so
    // the stream opens unscoped and its own error path retries the lookup.
  } finally {
    sharedTeamEvents.opening = false;
  }
  if (sharedTeamEvents.listeners.size === 0) {
    return;
  }
  const source = new EventSource(apiUrl("/api/me/team/events", orgId), {
    withCredentials: true,
  });
  sharedTeamEvents.source = source;
  source.addEventListener("team:roster", notifyTeamEventListeners);
  source.addEventListener("team:status", notifyTeamEventListeners);
  source.addEventListener("error", () => {
    source.close();
    if (sharedTeamEvents.source === source) {
      sharedTeamEvents.source = null;
    }
    if (sharedTeamEvents.listeners.size === 0 || sharedTeamEvents.reconnectTimer !== null) {
      return;
    }
    sharedTeamEvents.reconnectTimer = setTimeout(() => {
      sharedTeamEvents.reconnectTimer = null;
      void openSharedSource();
    }, RECONNECT_MS);
  });
};

const subscribeTeamEvents = (onEvent: () => void): (() => void) | null => {
  if (typeof EventSource === "undefined") {
    return null;
  }
  sharedTeamEvents.listeners.add(onEvent);
  void openSharedSource();
  return () => {
    sharedTeamEvents.listeners.delete(onEvent);
    if (sharedTeamEvents.listeners.size === 0) {
      closeSharedSource();
    }
  };
};

const fetchCatalogue = async (): Promise<Array<HireableTemplate>> => {
  const body = await request<{ templates: Array<HireableTemplate> }>(
    "/api/me/catalogue",
    "GET /api/me/catalogue",
  );
  return body.templates;
};

const hireMember = async (input: {
  displayName?: string;
  templateId: string;
}): Promise<TeamMemberView> => {
  const body = await request<{ member: TeamMemberView }>(
    "/api/me/team/hire",
    "POST /api/me/team/hire",
    jsonInit("POST", input),
  );
  return body.member;
};

const patchMember = async (
  id: string,
  patch: { displayName?: string; promptOverride?: string | null },
): Promise<TeamMemberView> => {
  const body = await request<{ member: TeamMemberView }>(
    `/api/me/team/members/${id}`,
    `PATCH /api/me/team/members/${id}`,
    jsonInit("PATCH", patch),
  );
  return body.member;
};

const fetchMemberDetail = async (id: string): Promise<TeamMemberDetailView> => {
  const body = await request<{ member: TeamMemberDetailView }>(
    `/api/me/team/members/${id}`,
    `GET /api/me/team/members/${id}`,
  );
  return body.member;
};

const setPaused = async (id: string, paused: boolean): Promise<TeamMemberView> => {
  const body = await request<{ member: TeamMemberView }>(
    `/api/me/team/members/${id}/${paused ? "pause" : "resume"}`,
    "pause/resume",
    { method: "POST" },
  );
  return body.member;
};

export {
  fetchCatalogue,
  fetchMemberDetail,
  fetchTeam,
  hireMember,
  patchMember,
  setPaused,
  STATUS_LABEL,
  subscribeTeamEvents,
};
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
