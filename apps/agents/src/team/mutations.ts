import { logActivity } from "@/activity/log";
import { getTemplate } from "@/db/template";
import { nextDisplayName } from "@/team/naming";
import { getMemberDetail, getTeamRoster } from "@/team/queries";
import type { TeamMemberView } from "@/team/types";

type HireInput = {
  companyId: string;
  displayName: string | undefined;
  templateId: string;
};

const NEW_WORKER_PREFIX = "wkr_";

// We use a UUID rather than the seeded worker IDs' deterministic
// `worker-${tpl}-${co}` form because multi-hire would collide. The seeded
// instances keep their stable IDs; everything created here gets a UUID.
const newWorkerId = (): string => `${NEW_WORKER_PREFIX}${crypto.randomUUID()}`;

const hireMember = async (
  db: D1Database,
  input: HireInput,
): Promise<TeamMemberView> => {
  const template = await getTemplate(db, input.templateId);
  if (!template) {
    throw new Error(`template ${input.templateId} not found`);
  }
  if (template.status !== "active") {
    throw new Error(`template ${input.templateId} is retired`);
  }

  const existingRoster = await getTeamRoster(db, input.companyId);
  const desiredName =
    input.displayName?.trim() ??
    nextDisplayName(
      template.displayName,
      existingRoster.map((m) => m.displayName),
    );

  const newId = newWorkerId();

  // Resolve the team and correspondent by querying DB — the seeded IDs in
  // tests don't follow the deterministic `teamIdFor`/`correspondentIdFor`
  // pattern, so we always look them up dynamically.
  const teamRow = await db
    .prepare("SELECT id FROM team WHERE company_id = ? LIMIT 1")
    .bind(input.companyId)
    .first<{ id: string }>();
  if (!teamRow) {
    throw new Error(`no team found for company ${input.companyId}`);
  }
  const teamId = teamRow.id;

  const corrRow = await db
    .prepare(
      `SELECT a.id, tm.can_delegate_to
         FROM agent_instance a
         JOIN team_member tm ON tm.agent_instance_id = a.id AND tm.team_id = ?
        WHERE a.company_id = ? AND a.role = 'correspondent'
        LIMIT 1`,
    )
    .bind(teamId, input.companyId)
    .first<{ can_delegate_to: string; id: string }>();
  if (!corrRow) {
    throw new Error(`correspondent team_member missing for ${input.companyId}`);
  }

  const targets = JSON.parse(corrRow.can_delegate_to) as Array<string>;
  const updatedTargets = [...targets, newId];
  const now = Date.now();

  await db.batch([
    db
      .prepare(
        `INSERT INTO agent_instance
           (id, company_id, role, template_id, template_version, display_name,
            model_override, status, prompt_override, created_at, updated_at)
         VALUES (?, ?, 'worker', ?, ?, ?, NULL, 'active', NULL, ?, ?)`,
      )
      .bind(
        newId,
        input.companyId,
        template.id,
        template.version,
        desiredName,
        now,
        now,
      ),
    db
      .prepare(
        "INSERT INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, '[]')",
      )
      .bind(teamId, newId),
    db
      .prepare(
        "UPDATE team_member SET can_delegate_to = ? WHERE agent_instance_id = ? AND team_id = ?",
      )
      .bind(JSON.stringify(updatedTargets), corrRow.id, teamId),
  ]);

  await logActivity(
    { DB: db },
    {
      companyId: input.companyId,
      payload: { displayName: desiredName, templateId: template.id },
      refId: newId,
      refType: "agent_instance",
      summary: `Agente "${desiredName}" contratado.`,
      type: "MEMBER_HIRED",
    },
  );

  const detail = await getMemberDetail(db, input.companyId, newId);
  if (!detail) {
    throw new Error("hireMember: failed to read back the new member");
  }

  return {
    currentWork: detail.currentWork,
    displayName: detail.displayName,
    hasPromptOverride: detail.hasPromptOverride,
    id: detail.id,
    lifetimeDone: detail.lifetimeDone,
    role: detail.role,
    status: detail.status,
    templateId: detail.templateId,
    workerKind: detail.workerKind,
  };
};

export { hireMember, NEW_WORKER_PREFIX, newWorkerId };
