import type { AgentInstanceStatus, AgentRole, Prisma, TicketStatus } from "@repo/db";
import type {
  HireableTemplate,
  OperatorCoverage,
  TeamMemberBase,
  TeamMemberDetailView,
  TeamMemberView,
} from "@repo/worker-api/contracts";

import { listCompaniesOverview } from "./companies";
import { listEntitledActiveTemplates } from "./templates";
import type { Database } from "./types";

const OPEN_TICKET_STATUSES: ReadonlyArray<TicketStatus> = ["in_progress", "awaiting_approval"];

const rosterInclude = {
  _count: { select: { tickets: { where: { status: "done" } } } },
  template: { select: { workerKind: true } },
  tickets: {
    select: { id: true, status: true, title: true },
    where: { status: { in: [...OPEN_TICKET_STATUSES] } },
  },
} as const satisfies Prisma.AgentInstanceInclude;

type ProjectableRow = {
  _count: { tickets: number };
  displayName: string;
  id: string;
  promptOverride: string | null;
  role: AgentRole;
  status: AgentInstanceStatus;
  template: { workerKind: string | null } | null;
  templateId: string | null;
  tickets: ReadonlyArray<{ id: string; status: TicketStatus; title: string }>;
};

const projectMember = (row: ProjectableRow): TeamMemberView => {
  const currentWork = row.tickets.flatMap((ticket) =>
    ticket.status === "in_progress" || ticket.status === "awaiting_approval"
      ? [{ status: ticket.status, summary: ticket.title, ticketId: ticket.id }]
      : [],
  );
  let status: TeamMemberBase["status"] = "available";
  if (row.status === "paused") {
    status = "paused";
  } else if (currentWork.some((ticket) => ticket.status === "in_progress")) {
    status = "working";
  } else if (currentWork.some((ticket) => ticket.status === "awaiting_approval")) {
    status = "awaiting_approval";
  }
  const base: TeamMemberBase = {
    currentWork,
    displayName: row.displayName,
    hasPromptOverride: row.promptOverride !== null,
    id: row.id,
    // oxlint-disable-next-line no-underscore-dangle -- Prisma exposes relation counts through its generated _count field.
    lifetimeDone: row._count.tickets,
    status,
  };
  if (row.role === "worker") {
    const workerKind = row.template?.workerKind;
    if (
      row.templateId === null ||
      row.templateId === "" ||
      workerKind === null ||
      workerKind === undefined ||
      workerKind === ""
    ) {
      throw new Error(`worker ${row.id} missing template_id or worker_kind`);
    }
    return { ...base, role: "worker", templateId: row.templateId, workerKind };
  }
  return { ...base, role: row.role, templateId: null, workerKind: null };
};

const sortRoster = (members: ReadonlyArray<TeamMemberView>): Array<TeamMemberView> => {
  const correspondent = members.filter(({ role }) => role === "correspondent");
  const others = members
    .filter(({ role }) => role !== "correspondent")
    .toSorted((a, b) =>
      a.currentWork.length === b.currentWork.length
        ? a.displayName.localeCompare(b.displayName, "pt-BR")
        : b.currentWork.length - a.currentWork.length,
    );
  return [...correspondent, ...others];
};

const listTeamRosters = async (
  db: Database,
  companyIds: ReadonlyArray<string>,
): Promise<Record<string, ReadonlyArray<TeamMemberView>>> => {
  const ids = [...new Set(companyIds)].filter(Boolean);
  const result: Record<string, ReadonlyArray<TeamMemberView>> = Object.fromEntries(
    ids.map((id) => [id, []]),
  );
  if (ids.length === 0) {
    return result;
  }
  const rows = await db.agentInstance.findMany({
    include: rosterInclude,
    orderBy: { createdAt: "asc" },
    where: { companyId: { in: ids } },
  });
  for (const companyId of ids) {
    result[companyId] = sortRoster(
      rows.filter((row) => row.companyId === companyId).map(projectMember),
    );
  }
  return result;
};

const getTeamRoster = async (
  db: Database,
  companyId: string,
): Promise<ReadonlyArray<TeamMemberView>> => {
  const rosters = await listTeamRosters(db, [companyId]);
  return rosters[companyId] ?? [];
};

const getTeamMember = async (
  db: Database,
  companyId: string,
  agentInstanceId: string,
): Promise<TeamMemberView | null> => {
  const row = await db.agentInstance.findFirst({
    include: rosterInclude,
    where: { companyId, id: agentInstanceId },
  });
  return row ? projectMember(row) : null;
};

const getCatalogue = async (
  db: Database,
  companyId: string,
): Promise<ReadonlyArray<HireableTemplate>> => {
  const [templates, counts] = await Promise.all([
    listEntitledActiveTemplates(db, companyId),
    db.agentInstance.groupBy({
      _count: { _all: true },
      by: ["templateId"],
      where: { companyId, role: "worker", templateId: { not: null } },
    }),
  ]);
  const countByTemplate = new Map(
    counts.map((row) => {
      // oxlint-disable-next-line no-underscore-dangle -- Prisma groupBy exposes aggregate counts through generated _count and _all fields.
      return [row.templateId, row._count._all];
    }),
  );
  return templates.map((template) => ({
    description: template.description,
    displayName: template.displayName,
    hiredCount: countByTemplate.get(template.id) ?? 0,
    id: template.id,
    workerKind: template.workerKind,
  }));
};

const getMemberDetail = async (
  db: Database,
  companyId: string,
  agentInstanceId: string,
): Promise<TeamMemberDetailView | null> => {
  const row = await db.agentInstance.findFirst({
    include: {
      _count: { select: { tickets: { where: { status: "done" } } } },
      company: { select: { name: true } },
      template: { select: { description: true, systemPrompt: true, workerKind: true } },
      tickets: {
        select: { id: true, status: true, title: true },
        where: { status: { in: [...OPEN_TICKET_STATUSES] } },
      },
    },
    where: { companyId, id: agentInstanceId },
  });
  if (!row) {
    return null;
  }
  const edited = await db.activityLog.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
    where: { companyId, refId: agentInstanceId, type: "MEMBER_PROMPT_EDITED" },
  });
  return {
    ...projectMember(row),
    capabilities: row.template?.description ?? "",
    companyName: row.company.name,
    createdAt: row.createdAt.getTime(),
    promptOverride: row.promptOverride,
    promptOverrideUpdatedAt: edited?.createdAt.getTime() ?? null,
    templateSystemPrompt: row.template?.systemPrompt ?? "",
  };
};

const getDelegationTargets = async (
  db: Database,
  agentInstanceId: string,
): Promise<ReadonlyArray<string> | null> => {
  const row = await db.teamMember.findFirst({
    select: { canDelegateTo: true },
    where: { agentInstanceId },
  });
  if (!row) {
    return null;
  }
  return Array.isArray(row.canDelegateTo)
    ? row.canDelegateTo.filter((value): value is string => typeof value === "string")
    : [];
};

const listCoverage = async (db: Database, operatorUserId: string): Promise<OperatorCoverage> => {
  const rows = await db.operatorAssignment.findMany({ where: { operatorUserId } });
  return {
    companies: rows.filter((row) => row.kind === "company").map((row) => row.value),
    disciplines: rows.filter((row) => row.kind === "discipline").map((row) => row.value),
  };
};

const assignmentOptions = async (db: Database) => {
  const [companies, rows] = await Promise.all([
    listCompaniesOverview(db),
    db.agentTemplate.findMany({
      distinct: ["workerKind"],
      orderBy: { workerKind: "asc" },
      select: { workerKind: true },
    }),
  ]);
  return { companies, disciplines: rows.map((row) => row.workerKind) };
};

export {
  assignmentOptions,
  getCatalogue,
  getDelegationTargets,
  getMemberDetail,
  getTeamMember,
  getTeamRoster,
  listCoverage,
  listTeamRosters,
};
