type AgentDisplayStatus = "available" | "awaiting_approval" | "paused" | "working";

type OpenTicketSlim = {
  status: "awaiting_approval" | "in_progress";
  summary: string;
  ticketId: string;
};

type TeamMemberView = {
  currentWork: ReadonlyArray<OpenTicketSlim>;
  displayName: string;
  hasPromptOverride: boolean;
  id: string;
  lifetimeDone: number;
  role: "correspondent" | "planner" | "worker";
  status: AgentDisplayStatus;
  templateId: string | null;
  workerKind: string | null;
};

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

export type {
  AgentDisplayStatus,
  HireableTemplate,
  OpenTicketSlim,
  TeamMemberDetailView,
  TeamMemberView,
};
