import type { CompanyBrief } from "./brief";
import type {
  Action,
  ActivityEntry,
  AssetKind,
  AssetSummary,
  AssetVisibility,
  Company,
  CompanyOverview,
  DecisionOutcome,
  HireableTemplate,
  InstanceWithTemplate,
  MaterializeResult,
  OperatorCoverage,
  SkillOverlay,
  TeamMemberDetailView,
  TeamMemberView,
  Template,
  TemplateInput,
  TemplateStatus,
  Ticket,
  TicketListRow,
  TicketStatus,
} from "./contracts";

type JsonValue = boolean | null | number | string | Array<JsonValue> | { [key: string]: JsonValue };
type JsonRecord = Record<string, JsonValue>;

type ActivityInput = {
  actorId?: string;
  companyId: string;
  payload?: JsonRecord;
  refId?: string;
  refType?: string;
  summary: string;
  type: string;
};

type ActivityOptions = {
  before?: number;
  category?: "ACTION" | "MEMBER" | "TEAM" | "TICKET" | "WORKER";
  companyId?: string;
  limit?: number;
  since?: number;
};

type CustomerCompany = {
  brief: Partial<CompanyBrief>;
  id: string;
  slug: string;
  status: Company["status"];
};

type AssetRecord = AssetSummary & {
  metadata: JsonRecord | null;
  r2Key: string;
};

type AssetAccess = { mime: string; r2Key: string };
type AssetReference = { mime: string; r2Key: string };
type AssetDeleteRecord = { id: string; r2Key: string };
type WorkerCandidate = { busyCount: number; id: string };
type ProactiveCompany = { brief: Partial<CompanyBrief>; id: string };

type TicketTransitionInput = {
  activity: ActivityInput;
  result?: JsonRecord;
  status: TicketStatus;
  ticketId: string;
};

type TeamUpdateInput = {
  agentInstanceId: string;
  companyId: string;
  displayName?: string;
  editedBy: "customer" | "operator";
  operatorId: string | null;
  promptOverride?: string | null;
};

type TeamStatusInput = {
  actorId?: string | null;
  agentInstanceId: string;
  companyId: string;
  status: "active" | "paused";
};

type WorkflowCompleteInput = {
  companyId: string;
  policy: "auto_execute" | "notify_only";
  summary: string;
  ticketId: string;
};

type WorkflowDecisionInput = {
  actionId: string;
  companyId: string;
  decidedByUserId: string;
  decision: DecisionOutcome;
  feedback?: string;
  summary: string;
  ticketId: string;
};

type WorkflowProposalInput = {
  actionType: string;
  companyId: string;
  feedback: string | null;
  policy: "require_approval";
  proposed: JsonRecord;
  round: number;
  summary: string;
  ticketId: string;
};

type AgentsApiOperations = {
  "actions.decide": {
    input: {
      actionId: string;
      decidedByUserId: string;
      decision: DecisionOutcome;
      feedback?: string;
    };
    output: boolean;
  };
  "actions.get": { input: { actionId: string }; output: Action | null };
  "actions.list": {
    input: { companyId?: string; limit?: number };
    output: ReadonlyArray<Action>;
  };
  "actions.listForTicket": { input: { ticketId: string }; output: ReadonlyArray<Action> };
  "actions.listPending": {
    input: {
      companyId?: string;
      companyIds?: ReadonlyArray<string>;
      disciplines?: ReadonlyArray<string>;
      limit?: number;
    };
    output: ReadonlyArray<Action>;
  };
  "actions.markExecuted": { input: { actionId: string }; output: null };
  "actions.propose": {
    input: {
      actionType: string;
      companyId: string;
      policy: Action["policy"];
      proposed: JsonRecord;
      ticketId: string;
    };
    output: { id: string };
  };
  "activity.list": { input: ActivityOptions; output: ReadonlyArray<ActivityEntry> };
  "activity.log": { input: ActivityInput; output: null };
  "assets.access": { input: { assetId: string }; output: AssetAccess | null };
  "assets.deleteBrand": {
    input: { assetId: string; companyId: string };
    output: { r2Key: string } | null;
  };
  "assets.deleteCustomer": {
    input: { companyId: string; ids: ReadonlyArray<string> };
    output: ReadonlyArray<AssetDeleteRecord>;
  };
  "assets.list": {
    input: { companyId: string; kind?: AssetKind; limit?: number; visibility?: AssetVisibility };
    output: ReadonlyArray<AssetSummary>;
  };
  "assets.listBrand": { input: { companyId: string }; output: ReadonlyArray<AssetRecord> };
  "assets.listCustomer": {
    input: { companyId: string; limit: number };
    output: ReadonlyArray<AssetRecord>;
  };
  "assets.listReferences": {
    input: { companyId: string; limit: number };
    output: ReadonlyArray<AssetReference>;
  };
  "assets.persist": {
    input: {
      bytes: number;
      companyId: string;
      id: string;
      kind: AssetKind;
      metadata: JsonRecord;
      mime: string;
      r2Key: string;
      sha256: string;
      visibility: AssetVisibility;
    };
    output: { assetId: string };
  };
  "assets.textMetadata": {
    input: { assetId: string; companyId: string };
    output: (AssetAccess & { id: string; kind: AssetKind; metadata: JsonRecord | null }) | null;
  };
  "assignments.get": { input: { operatorUserId: string }; output: OperatorCoverage };
  "assignments.options": {
    input: Record<string, never>;
    output: { companies: ReadonlyArray<CompanyOverview>; disciplines: ReadonlyArray<string> };
  };
  "assignments.set": {
    input: { coverage: OperatorCoverage; operatorUserId: string };
    output: null;
  };
  "companies.get": { input: { companyId: string }; output: Company | null };
  "companies.getCustomer": { input: { companyId: string }; output: CustomerCompany | null };
  "companies.listOverview": {
    input: Record<string, never>;
    output: ReadonlyArray<CompanyOverview>;
  };
  "companies.listProactive": {
    input: Record<string, never>;
    output: ReadonlyArray<ProactiveCompany>;
  };
  "companies.provision": {
    input: { id: string; name: string; slug: string };
    output: { ok: true };
  };
  "companies.updateBrief": {
    input: { companyId: string; updates: Partial<CompanyBrief> };
    output: CustomerCompany | null;
  };
  "memory.insert": {
    input: {
      agentInstanceId: string;
      companyId: string;
      content: string;
      id: string;
      kind: string;
      salience?: number;
    };
    output: null;
  };
  "proactive.lastSuggestedAt": { input: { companyId: string }; output: number | null };
  "teams.catalogue": { input: { companyId: string }; output: ReadonlyArray<HireableTemplate> };
  "teams.confirm": {
    input: { actorId: string; companyId: string; templateIds: ReadonlyArray<string> };
    output: { brief: Partial<CompanyBrief>; team: MaterializeResult };
  };
  "teams.delegationTargets": {
    input: { agentInstanceId: string };
    output: ReadonlyArray<string> | null;
  };
  "teams.hire": {
    input: {
      actorId: string | null;
      companyId: string;
      displayName?: string;
      templateId: string;
    };
    output: TeamMemberView;
  };
  "teams.memberDetail": {
    input: { agentInstanceId: string; companyId: string };
    output: TeamMemberDetailView | null;
  };
  "teams.roster": { input: { companyId: string }; output: ReadonlyArray<TeamMemberView> };
  "teams.rosters": {
    input: { companyIds: ReadonlyArray<string> };
    output: Record<string, ReadonlyArray<TeamMemberView>>;
  };
  "teams.setStatus": { input: TeamStatusInput; output: TeamMemberView };
  "teams.update": { input: TeamUpdateInput; output: TeamMemberView };
  "templates.create": { input: TemplateInput; output: Template };
  "templates.get": { input: { templateId: string }; output: Template | null };
  "templates.listActive": { input: { companyId: string }; output: ReadonlyArray<Template> };
  "templates.listAll": { input: Record<string, never>; output: ReadonlyArray<Template> };
  "templates.overlays": {
    input: { skillIds: ReadonlyArray<string> };
    output: ReadonlyArray<SkillOverlay>;
  };
  "templates.setStatus": {
    input: { status: TemplateStatus; templateId: string };
    output: Template | null;
  };
  "templates.update": { input: TemplateInput & { templateId: string }; output: Template | null };
  "tickets.createDelegated": {
    input: {
      agentInstanceId: string;
      brief: string;
      companyId: string;
      ticketId: string;
      workerKind: string;
    };
    output: null;
  };
  "tickets.list": {
    input: { companyId?: string; limit?: number; status?: TicketStatus };
    output: ReadonlyArray<TicketListRow>;
  };
  "tickets.load": { input: { ticketId: string }; output: Ticket | null };
  "tickets.loadInstance": {
    input: { agentInstanceId: string };
    output: { id: string; promptOverride: string | null; templateId: string | null } | null;
  };
  "tickets.loadInstanceWithTemplate": {
    input: { agentInstanceId: string };
    output: InstanceWithTemplate;
  };
  "tickets.setWorkflow": {
    input: { ticketId: string; workflowId: string };
    output: null;
  };
  "tickets.transition": { input: TicketTransitionInput; output: null };
  "workers.candidates": {
    input: { companyId: string; workerKind: string };
    output: ReadonlyArray<WorkerCandidate>;
  };
  "workflows.applyDecision": { input: WorkflowDecisionInput; output: null };
  "workflows.complete": { input: WorkflowCompleteInput; output: null };
  "workflows.propose": { input: WorkflowProposalInput; output: { id: string } };
};

type AgentsOperation = keyof AgentsApiOperations;
type AgentsApiConfig = { baseUrl: string; fetch?: typeof fetch; secret: string };

const defaultFetch = globalThis.fetch.bind(globalThis);

class AgentsApiError extends Error {
  code: string | null;
  status: number;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.code = code;
    this.name = "AgentsApiError";
    this.status = status;
  }
}

const createAgentsApi = (config: AgentsApiConfig) => {
  const baseUrl = config.baseUrl.replace(/\/$/v, "");
  const fetchImpl = config.fetch ?? defaultFetch;
  return async <Operation extends AgentsOperation>(
    operation: Operation,
    input: AgentsApiOperations[Operation]["input"],
  ): Promise<AgentsApiOperations[Operation]["output"]> => {
    const response = await fetchImpl(`${baseUrl}/api/internal/agents/${operation}`, {
      body: JSON.stringify(input),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.secret}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const error =
        typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
      const code =
        typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
          ? body.code
          : null;
      throw new AgentsApiError(
        response.status,
        typeof error === "string" ? error : `Internal agents API failed (${response.status})`,
        code,
      );
    }
    if (response.status === 204) {
      return null;
    }
    const body: unknown = await response.json();
    // SAFETY: The authenticated first-party endpoint dispatches this operation through the matching AgentsApiOperations contract.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return body as AgentsApiOperations[Operation]["output"];
  };
};

type AgentsApi = ReturnType<typeof createAgentsApi>;

export { AgentsApiError, createAgentsApi };
export type {
  ActivityInput,
  ActivityOptions,
  AgentsApi,
  AgentsApiConfig,
  AgentsApiOperations,
  AgentsOperation,
  AssetAccess,
  AssetDeleteRecord,
  AssetRecord,
  AssetReference,
  CustomerCompany,
  JsonRecord,
  JsonValue,
  ProactiveCompany,
  TeamStatusInput,
  TeamUpdateInput,
  TicketTransitionInput,
  WorkflowCompleteInput,
  WorkflowDecisionInput,
  WorkflowProposalInput,
  WorkerCandidate,
};
