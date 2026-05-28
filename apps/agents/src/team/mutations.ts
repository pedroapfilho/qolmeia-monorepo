import { logActivity } from "@/activity/log";
import { safeJson } from "@/db/mappers";
import { correspondentIdFor, teamIdFor } from "@/db/team";
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
  // Note: display_name has no DB-level uniqueness. Two concurrent hires for
  // the same template against the same roster snapshot could both compute
  // "Designer #2" and both succeed. Display names are cosmetic — treat as
  // soft labels, not identifiers.
  const desiredName =
    input.displayName?.trim() ??
    nextDisplayName(
      template.displayName,
      existingRoster.map((m) => m.displayName),
    );

  const newId = newWorkerId();

  const teamId = teamIdFor(input.companyId);
  const correspondentId = correspondentIdFor(input.companyId);

  const corrRow = await db
    .prepare("SELECT can_delegate_to FROM team_member WHERE agent_instance_id = ? AND team_id = ?")
    .bind(correspondentId, teamId)
    .first<{ can_delegate_to: string }>();
  if (!corrRow) {
    throw new Error(`correspondent team_member missing for ${input.companyId}`);
  }
  const targets = safeJson<Array<string>>(corrRow.can_delegate_to, []);
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
      .bind(JSON.stringify(updatedTargets), correspondentId, teamId),
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
