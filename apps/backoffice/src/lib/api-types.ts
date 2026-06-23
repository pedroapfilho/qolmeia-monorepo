// Shapes returned by apps/agents /api/backoffice/* — duplicated here on
// purpose: the agents Worker and the backoffice are deployed independently,
// so a runtime contract is healthier than a build-time import that couples
// them.

type TicketStatus =
  | "awaiting_approval"
  | "blocked"
  | "cancelled"
  | "done"
  | "in_progress"
  | "open"
  | "rejected";

type Ticket = {
  agentInstanceId: string;
  brief: string;
  companyId: string;
  id: string;
  result: Record<string, unknown> | null;
  status: TicketStatus;
  workflowId: string | null;
};

type TicketListRow = Ticket & {
  companyName: string;
  createdAt: number;
  origin: string;
  title: string;
  updatedAt: number;
};

type ActionStatus = "approved" | "changes_requested" | "executed" | "pending" | "rejected";

type ActionPolicy = "auto-execute" | "notify-only" | "require-approval";

// The agent that owns the action's ticket — drives the role-keyed avatar.
type ActionAgent = {
  name: string;
  role: "correspondent" | "planner" | "worker";
  workerKind: string | null;
};

type Action = {
  actionType: string;
  agent: ActionAgent;
  companyId: string;
  companyName: string;
  createdAt: number;
  decidedAt: number | null;
  decidedByUserId: string | null;
  feedback: string | null;
  id: string;
  policy: ActionPolicy;
  proposed: Record<string, unknown>;
  status: ActionStatus;
  ticketId: string;
};

type ActionListRow = Action & {
  ageSeconds?: number;
};

type ActivityEntry = {
  actorId: string | null;
  companyId: string;
  companyName: string;
  createdAt: number;
  id: string;
  payload: Record<string, unknown> | null;
  refId: string | null;
  refType: string | null;
  summary: string;
  type: string;
};

type TicketsResponse = { items: ReadonlyArray<TicketListRow> };
type ActionsResponse = { items: ReadonlyArray<ActionListRow> };
type ActivityResponse = { items: ReadonlyArray<ActivityEntry> };
type TicketDetailResponse = { actions: ReadonlyArray<Action>; ticket: Ticket };
type ActionDetailResponse = { action: Action; ageSeconds: number; ticket: Ticket | null };

type DecisionOutcome = "approved" | "changes_requested" | "rejected";

// ADR 0005 operator coverage. `assigned` is the operator's current set;
// `options` are the pickable companies + disciplines (template worker_kinds).
type OperatorCoverage = {
  companies: ReadonlyArray<string>;
  disciplines: ReadonlyArray<string>;
};

type CoverageResponse = {
  assigned: OperatorCoverage;
  options: {
    companies: ReadonlyArray<{ id: string; name: string }>;
    disciplines: ReadonlyArray<string>;
  };
};

// Worker-template catalog. Mirrors the agents `Template` shape (camelCase).
type TemplateStatus = "active" | "retired";

type Template = {
  createdAt: number;
  defaultActionType: string;
  defaultPolicies: Record<string, string>;
  description: string;
  displayName: string;
  id: string;
  model: string;
  skillIds: ReadonlyArray<string>;
  status: TemplateStatus;
  systemPrompt: string;
  updatedAt: number;
  version: number;
  workerKind: string;
};

// The payload accepted by POST/PATCH /templates (no id/version/timestamps —
// the server owns those).
type TemplateInput = {
  defaultActionType: string;
  defaultPolicies: Record<string, string>;
  description: string;
  displayName: string;
  model: string;
  skillIds: ReadonlyArray<string>;
  systemPrompt: string;
  workerKind: string;
};

type SkillCatalogEntry = {
  description: string;
  displayName: string;
  id: string;
};

type TemplatesResponse = { items: ReadonlyArray<Template> };
type TemplateResponse = { template: Template };
type SkillCatalogResponse = { items: ReadonlyArray<SkillCatalogEntry> };

type MeResponse = {
  currentOrg: {
    id: string;
    name: string;
    role: "OWNER" | "STAFF" | "CUSTOMER";
    slug: string;
  } | null;
  role: "OWNER" | "STAFF" | "CUSTOMER";
  user: {
    displayName: string | null;
    email: string;
    id: string;
    name: string;
  };
};

export type {
  Action,
  ActionAgent,
  ActionDetailResponse,
  ActionListRow,
  ActionPolicy,
  ActionsResponse,
  ActionStatus,
  ActivityEntry,
  ActivityResponse,
  CoverageResponse,
  DecisionOutcome,
  MeResponse,
  OperatorCoverage,
  SkillCatalogEntry,
  SkillCatalogResponse,
  Template,
  TemplateInput,
  TemplateResponse,
  TemplatesResponse,
  TemplateStatus,
  Ticket,
  TicketDetailResponse,
  TicketListRow,
  TicketsResponse,
  TicketStatus,
};
