import type { AgentInstanceStatus, AgentRole, Prisma, TicketStatus } from "@repo/db/worker";

import type { Database } from "#/db/client";
import { listEntitledActiveTemplates } from "#/db/template";
import { resolveAgentStatus } from "#/team/status";
import type {
  HireableTemplate,
  OpenTicketSlim,
  TeamMemberBase,
  TeamMemberDetailView,
  TeamMemberView,
} from "#/team/types";

const OPEN_TICKET_STATUSES: ReadonlyArray<TicketStatus> = ["in_progress", "awaiting_approval"];

const rosterInclude = {
  // oxlint-disable-next-line no-underscore-dangle -- Prisma aggregate API.
  _count: { select: { tickets: { where: { status: "done" } } } },
  template: { select: { workerKind: true } },
  tickets: {
    select: { id: true, status: true, title: true },
    where: { status: { in: [...OPEN_TICKET_STATUSES] } },
  },
} as const satisfies Prisma.AgentInstanceInclude;

const isOpenStatus = (status: TicketStatus): status is OpenTicketSlim["status"] =>
  status === "in_progress" || status === "awaiting_approval";
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

type ProjectableRow = {
  // oxlint-disable-next-line no-underscore-dangle -- Prisma aggregate result.
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
    isOpenStatus(ticket.status)
      ? [{ status: ticket.status, summary: ticket.title, ticketId: ticket.id }]
      : [],
  );
  const base: TeamMemberBase = {
    currentWork,
    displayName: row.displayName,
    hasPromptOverride: row.promptOverride !== null,
    id: row.id,
    // oxlint-disable-next-line no-underscore-dangle -- Prisma aggregate result.
    lifetimeDone: row._count.tickets,
    status: resolveAgentStatus({ status: row.status }, currentWork),
  };
  const role = row.role;
  if (role === "worker") {
    if (
      row.templateId === null ||
      row.templateId === "" ||
      row.template?.workerKind === undefined ||
      row.template.workerKind === null ||
      row.template.workerKind === ""
    ) {
      throw new Error(`worker ${row.id} missing template_id or worker_kind`);
    }
    return {
      ...base,
      role: "worker",
      templateId: row.templateId,
      workerKind: row.template.workerKind,
    };
  }
  return { ...base, role, templateId: null, workerKind: null };
};

const listTeamRosters = async (
  db: Database,
  companyIds: ReadonlyArray<string>,
): Promise<Map<string, Array<TeamMemberView>>> => {
  const ids = [...new Set(companyIds)].filter(Boolean);
  const result = new Map<string, Array<TeamMemberView>>(ids.map((id) => [id, []]));
  if (!ids.length) {
    return result;
  }
  const rows = await db.agentInstance.findMany({
    include: rosterInclude,
    orderBy: { createdAt: "asc" },
    where: { companyId: { in: ids } },
  });
  for (const companyId of ids) {
    result.set(
      companyId,
      sortRoster(rows.filter((row) => row.companyId === companyId).map(projectMember)),
    );
  }
  return result;
};
const getTeamRoster = async (db: Database, companyId: string): Promise<Array<TeamMemberView>> => {
  const rosters = await listTeamRosters(db, [companyId]);
  return rosters.get(companyId) ?? [];
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

const getCatalogue = async (db: Database, companyId: string): Promise<Array<HireableTemplate>> => {
  const [templates, counts] = await Promise.all([
    listEntitledActiveTemplates(db, companyId),
    db.agentInstance.groupBy({
      // oxlint-disable-next-line no-underscore-dangle -- Prisma aggregate API.
      _count: { _all: true },
      by: ["templateId"],
      where: { companyId, role: "worker", templateId: { not: null } },
    }),
  ]);
  // oxlint-disable-next-line no-underscore-dangle -- Prisma aggregate result.
  const countByTemplate = new Map(counts.map((row) => [row.templateId, row._count._all]));
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
      // oxlint-disable-next-line no-underscore-dangle -- Prisma aggregate API.
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

export { getCatalogue, getMemberDetail, getTeamMember, getTeamRoster, listTeamRosters };
export type { HireableTemplate, TeamMemberDetailView, TeamMemberView } from "#/team/types";
