import { resolveAgentStatus } from "@/team/status";
import type {
  HireableTemplate,
  OpenTicketSlim,
  TeamMemberBase,
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

const toRole = (s: string): "correspondent" | "planner" | "worker" => {
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

const getTeamRoster = async (db: D1Database, companyId: string): Promise<Array<TeamMemberView>> => {
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
  // Independent reads — run both D1 round trips in parallel.
  const [{ results: openRows }, { results: doneRows }] = await Promise.all([
    db
      .prepare(
        `SELECT id, agent_instance_id, title, status
           FROM ticket
          WHERE company_id = ?
            AND agent_instance_id IN (${placeholders})
            AND status IN ('in_progress', 'awaiting_approval')
          ORDER BY created_at ASC`,
      )
      .bind(companyId, ...ids)
      .all<TicketSlimRow>(),
    db
      .prepare(
        `SELECT agent_instance_id, COUNT(*) AS n
           FROM ticket
          WHERE company_id = ?
            AND agent_instance_id IN (${placeholders})
            AND status = 'done'
          GROUP BY agent_instance_id`,
      )
      .bind(companyId, ...ids)
      .all<DoneCountRow>(),
  ]);

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
    const role = toRole(row.role);
    const current = openByAgent.get(row.id) ?? [];
    const status = resolveAgentStatus({ status: toInstanceStatus(row.status) }, current);
    const currentWork = current;
    const displayName = row.display_name;
    const hasPromptOverride = row.prompt_override !== null;
    const id = row.id;
    const lifetimeDone = doneByAgent.get(row.id) ?? 0;
    if (role === "worker") {
      if (!row.template_id || !row.worker_kind) {
        // Data corruption: a worker row missing template metadata.
        throw new Error(`worker ${row.id} missing template_id or worker_kind`);
      }
      return {
        currentWork,
        displayName,
        hasPromptOverride,
        id,
        lifetimeDone,
        role: "worker",
        status,
        templateId: row.template_id,
        workerKind: row.worker_kind,
      };
    }
    return {
      currentWork,
      displayName,
      hasPromptOverride,
      id,
      lifetimeDone,
      role,
      status,
      templateId: null,
      workerKind: null,
    };
  });

  return sortRoster(members);
};

type CatalogueCountRow = { n: number; template_id: string };

const getCatalogue = async (
  db: D1Database,
  companyId: string,
): Promise<Array<HireableTemplate>> => {
  // Independent reads — run both D1 round trips in parallel.
  const [{ results: templates }, { results: counts }] = await Promise.all([
    db
      .prepare(
        `SELECT id, display_name, description, worker_kind
           FROM template
          WHERE status = 'active'
          ORDER BY display_name ASC`,
      )
      .all<{ description: string; display_name: string; id: string; worker_kind: string }>(),
    db
      .prepare(
        `SELECT template_id, COUNT(*) AS n
           FROM agent_instance
          WHERE company_id = ? AND role = 'worker' AND template_id IS NOT NULL
          GROUP BY template_id`,
      )
      .bind(companyId)
      .all<CatalogueCountRow>(),
  ]);

  const countByTemplate = new Map<string, number>();
  for (const row of counts) {
    countByTemplate.set(row.template_id, row.n);
  }

  return templates.map((t) => ({
    description: t.description,
    displayName: t.display_name,
    hiredCount: countByTemplate.get(t.id) ?? 0,
    id: t.id,
    workerKind: t.worker_kind,
  }));
};

type DetailRow = RosterRow & {
  description: string | null;
  system_prompt: string | null;
};

const getMemberDetail = async (
  db: D1Database,
  companyId: string,
  agentInstanceId: string,
): Promise<TeamMemberDetailView | null> => {
  const row = await db
    .prepare(
      `SELECT a.id, a.display_name, a.role, a.status, a.template_id, a.prompt_override,
              t.worker_kind, t.description, t.system_prompt
         FROM agent_instance a
         LEFT JOIN template t ON t.id = a.template_id
        WHERE a.id = ? AND a.company_id = ?`,
    )
    .bind(agentInstanceId, companyId)
    .first<DetailRow>();
  if (!row) {
    return null;
  }

  // Three independent reads — run the D1 round trips in parallel.
  const [{ results: openRows }, done, editedRow] = await Promise.all([
    db
      .prepare(
        `SELECT id, agent_instance_id, title, status
           FROM ticket
          WHERE company_id = ? AND agent_instance_id = ?
            AND status IN ('in_progress', 'awaiting_approval')`,
      )
      .bind(companyId, agentInstanceId)
      .all<TicketSlimRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM ticket
          WHERE company_id = ? AND agent_instance_id = ? AND status = 'done'`,
      )
      .bind(companyId, agentInstanceId)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT created_at FROM activity_log
          WHERE company_id = ? AND ref_id = ? AND type = 'MEMBER_PROMPT_EDITED'
          ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(companyId, agentInstanceId)
      .first<{ created_at: number }>(),
  ]);
  const currentWork: Array<OpenTicketSlim> = openRows.flatMap((r) => {
    const s = toOpenStatus(r.status);
    return s ? [{ status: s, summary: r.title, ticketId: r.id }] : [];
  });

  const role = toRole(row.role);
  const detailExtras = {
    capabilities: row.description ?? "",
    promptOverride: row.prompt_override,
    promptOverrideUpdatedAt: editedRow?.created_at ?? null,
    templateSystemPrompt: row.system_prompt ?? "",
  };
  const base: TeamMemberBase = {
    currentWork,
    displayName: row.display_name,
    hasPromptOverride: row.prompt_override !== null,
    id: row.id,
    lifetimeDone: done?.n ?? 0,
    status: resolveAgentStatus({ status: toInstanceStatus(row.status) }, currentWork),
  };
  if (role === "worker") {
    if (!row.template_id || !row.worker_kind) {
      throw new Error(`worker ${row.id} missing template_id or worker_kind`);
    }
    return {
      ...base,
      ...detailExtras,
      role: "worker",
      templateId: row.template_id,
      workerKind: row.worker_kind,
    };
  }
  return { ...base, ...detailExtras, role, templateId: null, workerKind: null };
};

export { getCatalogue, getMemberDetail, getTeamRoster };
export type { HireableTemplate, TeamMemberDetailView, TeamMemberView };
