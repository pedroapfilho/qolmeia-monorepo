import type {
  ActionPolicy,
  ActionStatus,
  AgentRole,
  TemplateStatus,
  TicketStatus,
} from "@repo/db/enums";

type WireValue =
  | boolean
  | number
  | string
  | null
  | ReadonlyArray<WireValue>
  | { readonly [key: string]: WireValue };
type WireObject = Readonly<Record<string, WireValue>>;

/**
 * The Worker and both Next apps share these wire shapes. Closed-set fields use
 * Prisma enums so schema changes fail typechecking instead of silently drifting
 * between producers and consumers.
 */

type Ticket = {
  agentInstanceId: string;
  brief: string;
  companyId: string;
  id: string;
  result: WireObject | null;
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

type ActionAgent = {
  name: string;
  role: AgentRole;
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
  proposed: WireObject;
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
  payload: WireObject | null;
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

export type {
  Action,
  ActionAgent,
  ActionDetailResponse,
  ActionListRow,
  ActionsResponse,
  ActivityEntry,
  ActivityResponse,
  CoverageResponse,
  DecisionOutcome,
  OperatorCoverage,
  SkillCatalogEntry,
  SkillCatalogResponse,
  Template,
  TemplateInput,
  TemplateResponse,
  TemplatesResponse,
  Ticket,
  TicketDetailResponse,
  TicketListRow,
  TicketsResponse,
  WireObject,
  WireValue,
};
export type {
  ActionPolicy,
  ActionStatus,
  AgentRole,
  TemplateStatus,
  TicketStatus,
} from "@repo/db/enums";
