import type { Prisma } from "@repo/db/worker";

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

const OPEN_TICKET_STATUSES = ["in_progress", "awaiting_approval"];

const rosterInclude = {
  // oxlint-disable-next-line no-underscore-dangle -- Prisma aggregate API.
  _count: { select: { tickets: { where: { status: "done" } } } },
  template: { select: { workerKind: true } },
  tickets: {
    select: { id: true, status: true, title: true },
    where: { status: { in: OPEN_TICKET_STATUSES } },
  },
} as const satisfies Prisma.AgentInstanceInclude;
type RosterRecord = Prisma.AgentInstanceGetPayload<{ include: typeof rosterInclude }>;

const toOpenStatus = (status: string): OpenTicketSlim["status"] | null =>
  status === "in_progress" || status === "awaiting_approval" ? status : null;
const toRole = (role: string): "correspondent" | "planner" | "worker" =>
  role === "correspondent" || role === "planner" || role === "worker" ? role : "worker";
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

const projectRosterMember = (row: RosterRecord): TeamMemberView => {
  const currentWork = row.tickets.flatMap((ticket) => {
    const status = toOpenStatus(ticket.status);
    return status ? [{ status, summary: ticket.title, ticketId: ticket.id }] : [];
  });
  const base: TeamMemberBase = {
    currentWork,
    displayName: row.displayName,
    hasPromptOverride: row.promptOverride !== null,
    id: row.id,
    // oxlint-disable-next-line no-underscore-dangle -- Prisma aggregate result.
    lifetimeDone: row._count.tickets,
    status: resolveAgentStatus(
      { status: row.status === "paused" ? "paused" : "active" },
      currentWork,
    ),
  };
  const role = toRole(row.role);
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
  const result = new Map(ids.map((id) => [id, [] as Array<TeamMemberView>]));
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
      sortRoster(rows.filter((row) => row.companyId === companyId).map(projectRosterMember)),
    );
  }
  return result;
};
const getTeamRoster = async (db: Database, companyId: string): Promise<Array<TeamMemberView>> => {
  const rosters = await listTeamRosters(db, [companyId]);
  return rosters.get(companyId) ?? [];
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
        where: { status: { in: OPEN_TICKET_STATUSES } },
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
  const currentWork = row.tickets.flatMap((ticket) => {
    const status = toOpenStatus(ticket.status);
    return status ? [{ status, summary: ticket.title, ticketId: ticket.id }] : [];
  });
  const base: TeamMemberBase = {
    currentWork,
    displayName: row.displayName,
    hasPromptOverride: row.promptOverride !== null,
    id: row.id,
    // oxlint-disable-next-line no-underscore-dangle -- Prisma aggregate result.
    lifetimeDone: row._count.tickets,
    status: resolveAgentStatus(
      { status: row.status === "paused" ? "paused" : "active" },
      currentWork,
    ),
  };
  const extras = {
    capabilities: row.template?.description ?? "",
    companyName: row.company.name,
    createdAt: row.createdAt.getTime(),
    promptOverride: row.promptOverride,
    promptOverrideUpdatedAt: edited?.createdAt.getTime() ?? null,
    templateSystemPrompt: row.template?.systemPrompt ?? "",
  };
  const role = toRole(row.role);
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
      ...extras,
      role: "worker",
      templateId: row.templateId,
      workerKind: row.template.workerKind,
    };
  }
  return { ...base, ...extras, role, templateId: null, workerKind: null };
};

export { getCatalogue, getMemberDetail, getTeamRoster, listTeamRosters };
export type { HireableTemplate, TeamMemberDetailView, TeamMemberView } from "#/team/types";
