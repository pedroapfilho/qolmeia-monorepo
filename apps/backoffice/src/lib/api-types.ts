// Shapes returned by apps/api /api/v1/* — duplicated here on purpose: the
// API and backoffice are deployed independently, so a runtime type contract
// is healthier than a build-time import that couples them.

type Paginated<T> = {
  items: ReadonlyArray<T>;
  nextCursor: string | null;
};

type AgentSummary = {
  budgetCents: number;
  createdAt: string;
  displayName: string;
  id: string;
  isActive: boolean;
  lastRunAt: string | null;
  mission: string;
  skillCount: number;
  status: "ACTIVE" | "PAUSED";
  template: { displayName: string; slug: string };
  templateSlug: string;
  updatedAt: string;
};

type AgentRunSummary = {
  costCents: number;
  costInputTokens: number;
  costOutputTokens: number;
  finishedAt: string | null;
  id: string;
  startedAt: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
};

type AgentDetail = AgentSummary & {
  recentRuns: ReadonlyArray<AgentRunSummary>;
};

type ApprovalRow = {
  agentInstanceId: string;
  agentTemplateDisplayName: string;
  createdAt: string;
  id: string;
  proposedInput: unknown;
  proposedSummary: string;
  skill: { displayName: string; id: string };
  skillId: string;
};

type ApprovalDetail = {
  agentInstance: { displayName: string; id: string; templateSlug: string };
  agentInstanceId: string;
  createdAt: string;
  id: string;
  proposedInput: unknown;
  proposedSummary: string;
  skill: {
    description: string;
    displayName: string;
    id: string;
    parametersJsonSchema: unknown;
  };
  skillId: string;
  status: string;
};

type ActivityLogType =
  | "MESSAGE_INBOUND"
  | "MESSAGE_OUTBOUND"
  | "AGENT_RUN_STARTED"
  | "AGENT_RUN_FINISHED"
  | "AGENT_RUN_FAILED"
  | "ACTION_EXECUTED"
  | "ACTION_FAILED"
  | "ACTION_DRAFTED"
  | "ACTION_APPROVED"
  | "ACTION_REJECTED"
  | "BUDGET_WARN_80"
  | "BUDGET_WARN_100"
  | "INSTRUCTIONS_UPDATED"
  | "BUSINESS_IDEA_UPDATED"
  | "OWNER_COMMAND"
  | "ROUTINE_TRIGGERED"
  | "ROUTINE_ENABLED"
  | "ROUTINE_DISABLED"
  | "MEMBER_INVITED"
  | "MEMBER_JOINED";

type ActivityLogRefType =
  | "MESSAGE"
  | "AGENT_RUN"
  | "AGENT_ACTION"
  | "ORGANIZATION"
  | "ROUTINE"
  | "NONE";

type ActivityRow = {
  actorId: string | null;
  createdAt: string;
  id: string;
  orgId: string;
  payload: unknown;
  refId: string | null;
  refType: ActivityLogRefType;
  summary: string;
  type: ActivityLogType;
};

type SoulPayload = {
  agentInstructions: string | null;
  businessIdea: string | null;
  businessProfile: unknown;
};

type RunRow = {
  agentInstanceId: string;
  costCents: number;
  costInputTokens: number;
  costOutputTokens: number;
  createdAt: string;
  errorMessage: string | null;
  finishedAt: string | null;
  id: string;
  parentRunId: string | null;
  startedAt: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  triggerMessageId: string | null;
};

type TeamRole = "OWNER" | "STAFF" | "CUSTOMER";

type TeamMemberRow = {
  createdAt: string;
  id: string;
  role: TeamRole;
  user: {
    displayName: string | null;
    email: string;
    id: string;
    image: string | null;
    name: string;
  };
};

type TeamMembersResponse = {
  items: ReadonlyArray<TeamMemberRow>;
};

export type {
  ActivityLogRefType,
  ActivityLogType,
  ActivityRow,
  AgentDetail,
  AgentRunSummary,
  AgentSummary,
  ApprovalDetail,
  ApprovalRow,
  Paginated,
  RunRow,
  SoulPayload,
  TeamMemberRow,
  TeamMembersResponse,
  TeamRole,
};
