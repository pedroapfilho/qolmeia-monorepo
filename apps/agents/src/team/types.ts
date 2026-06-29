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

type TeamMemberDetailExtras = {
  capabilities: string;
  companyName: string;
  createdAt: number;
  promptOverride: string | null;
  promptOverrideUpdatedAt: number | null;
  templateSystemPrompt: string;
};

type TeamMemberDetailView = TeamMemberView & TeamMemberDetailExtras;

type HireableTemplate = {
  description: string;
  displayName: string;
  hiredCount: number;
  id: string;
  workerKind: string;
};

export type {
  AgentDisplayStatus,
  HireableTemplate,
  OpenTicketSlim,
  TeamMemberBase,
  TeamMemberDetailView,
  TeamMemberDetailExtras,
  TeamMemberNonWorker,
  TeamMemberView,
  TeamMemberWorker,
};
