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
  DecisionOutcome,
  MeResponse,
  Ticket,
  TicketDetailResponse,
  TicketListRow,
  TicketsResponse,
  TicketStatus,
};
