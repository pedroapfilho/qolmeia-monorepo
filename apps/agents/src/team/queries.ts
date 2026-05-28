import { resolveAgentStatus } from "@/team/status";
import type {
  HireableTemplate,
  OpenTicketSlim,
  TeamMemberDetailView,
  TeamMemberView,
} from "@/team/types";

type RosterRow = {
  display_name: string;
  id: string;
  prompt_override: string | null;
  role: string;
  status: string;
  template_id: string | null;
  worker_kind: string | null;
};

type TicketSlimRow = {
  agent_instance_id: string;
  id: string;
  status: string;
  title: string;
};

type DoneCountRow = { agent_instance_id: string; n: number };

const toOpenStatus = (s: string): OpenTicketSlim["status"] | null =>
  s === "in_progress" || s === "awaiting_approval" ? s : null;

const toInstanceStatus = (s: string): "active" | "paused" => (s === "paused" ? "paused" : "active");

const toRole = (s: string): TeamMemberView["role"] => {
  if (s === "correspondent" || s === "planner" || s === "worker") {
    return s;
  }
  return "worker";
};

const sortRoster = (members: ReadonlyArray<TeamMemberView>): Array<TeamMemberView> => {
  const correspondent = members.filter((m) => m.role === "correspondent");
  const others = members
    .filter((m) => m.role !== "correspondent")
    .toSorted((a, b) => {
      const aActive = a.currentWork.length > 0 ? 1 : 0;
      const bActive = b.currentWork.length > 0 ? 1 : 0;
      if (aActive !== bActive) {
        return bActive - aActive;
      }
      return a.displayName.localeCompare(b.displayName, "pt-BR");
    });
  return [...correspondent, ...others];
};

const getTeamRoster = async (
  db: D1Database,
  companyId: string,
): Promise<Array<TeamMemberView>> => {
  const { results: rosterRows } = await db
    .prepare(
      `SELECT a.id, a.display_name, a.role, a.status, a.template_id, a.prompt_override,
              t.worker_kind
         FROM agent_instance a
         LEFT JOIN template t ON t.id = a.template_id
        WHERE a.company_id = ?
        ORDER BY a.created_at ASC`,
    )
    .bind(companyId)
    .all<RosterRow>();

  if (rosterRows.length === 0) {
    return [];
  }

  const ids = rosterRows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results: openRows } = await db
    .prepare(
      `SELECT id, agent_instance_id, title, status
         FROM ticket
        WHERE company_id = ?
          AND agent_instance_id IN (${placeholders})
          AND status IN ('in_progress', 'awaiting_approval')
        ORDER BY created_at ASC`,
    )
    .bind(companyId, ...ids)
    .all<TicketSlimRow>();
  const { results: doneRows } = await db
    .prepare(
      `SELECT agent_instance_id, COUNT(*) AS n
         FROM ticket
        WHERE company_id = ?
          AND agent_instance_id IN (${placeholders})
          AND status = 'done'
        GROUP BY agent_instance_id`,
    )
    .bind(companyId, ...ids)
    .all<DoneCountRow>();

  const openByAgent = new Map<string, Array<OpenTicketSlim>>();
  for (const row of openRows) {
    const status = toOpenStatus(row.status);
    if (!status) {
      continue;
    }
    const bucket = openByAgent.get(row.agent_instance_id) ?? [];
    bucket.push({ status, summary: row.title, ticketId: row.id });
    openByAgent.set(row.agent_instance_id, bucket);
  }

  const doneByAgent = new Map<string, number>();
  for (const row of doneRows) {
    doneByAgent.set(row.agent_instance_id, row.n);
  }

  const members: Array<TeamMemberView> = rosterRows.map((row) => {
    const current = openByAgent.get(row.id) ?? [];
    return {
      currentWork: current,
      displayName: row.display_name,
      hasPromptOverride: row.prompt_override !== null,
      id: row.id,
      lifetimeDone: doneByAgent.get(row.id) ?? 0,
      role: toRole(row.role),
      status: resolveAgentStatus({ status: toInstanceStatus(row.status) }, current),
      templateId: row.template_id,
      workerKind: row.worker_kind,
    };
  });

  return sortRoster(members);
};

export { getTeamRoster };
export type { HireableTemplate, TeamMemberDetailView, TeamMemberView };
