import { logActivity } from "#/activity/log";
import { safeJson } from "#/db/mappers";
import { correspondentIdFor, teamIdFor } from "#/db/team";
import { getTemplate, isTemplateEntitledForCompany } from "#/db/template";
import { logError } from "#/lib/logger";
import {
  CorrespondentMissingError,
  TeamMemberNotFoundError,
  TeamMemberNotPausableError,
  TemplateNotFoundError,
  TemplateRetiredError,
} from "#/team/errors";
import { nextDisplayName } from "#/team/naming";
import { getMemberDetail, getTeamRoster } from "#/team/queries";
import type { TeamMemberBase, TeamMemberDetailView, TeamMemberView } from "#/team/types";

const projectMemberView = (detail: TeamMemberDetailView): TeamMemberView => {
  const base: TeamMemberBase = {
    currentWork: detail.currentWork,
    displayName: detail.displayName,
    hasPromptOverride: detail.hasPromptOverride,
    id: detail.id,
    lifetimeDone: detail.lifetimeDone,
    status: detail.status,
  };
  if (detail.role === "worker") {
    return {
      ...base,
      role: "worker",
      templateId: detail.templateId,
      workerKind: detail.workerKind,
    };
  }
  return { ...base, role: detail.role, templateId: null, workerKind: null };
};

type HireInput = {
  actorId: string | null;
  companyId: string;
  displayName: string | undefined;
  templateId: string;
};

const NEW_WORKER_PREFIX = "wkr_";

const newWorkerId = (): string => `${NEW_WORKER_PREFIX}${crypto.randomUUID()}`;

const hireMember = async (db: D1Database, input: HireInput): Promise<TeamMemberView> => {
  const template = await getTemplate(db, input.templateId);
  if (!template) {
    throw new TemplateNotFoundError(input.templateId);
  }
  if (template.status !== "active") {
    throw new TemplateRetiredError(input.templateId);
  }
  if (!(await isTemplateEntitledForCompany(db, input.companyId, input.templateId))) {
    throw new TemplateNotFoundError(input.templateId);
  }

  const existingRoster = await getTeamRoster(db, input.companyId);
  const trimmedName = input.displayName?.trim();
  const desiredName =
    trimmedName && trimmedName.length > 0
      ? trimmedName
      : nextDisplayName(
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
    throw new CorrespondentMissingError(input.companyId);
  }
  const targets = safeJson<Array<string>>(corrRow.can_delegate_to, []);
  const updatedTargets = [...targets, newId];
  const now = Date.now();

  // oxlint-disable-next-line react-doctor/async-parallel -- ordered: activity log and read-back must observe the committed batch
  await db.batch([
    db
      .prepare(
        `INSERT INTO agent_instance
           (id, company_id, role, template_id, template_version, display_name,
            model_override, status, prompt_override, created_at, updated_at)
         VALUES (?, ?, 'worker', ?, ?, ?, NULL, 'active', NULL, ?, ?)`,
      )
      .bind(newId, input.companyId, template.id, template.version, desiredName, now, now),
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
      actorId: input.actorId ?? undefined,
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
    logError("team.hireMember.readBack.missing", {
      agentInstanceId: newId,
      companyId: input.companyId,
    });
    throw new Error("hireMember: failed to read back the new member");
  }

  return projectMemberView(detail);
};

const assertMemberPausable = async (
  db: D1Database,
  companyId: string,
  agentInstanceId: string,
): Promise<void> => {
  const row = await db
    .prepare("SELECT role FROM agent_instance WHERE id = ? AND company_id = ?")
    .bind(agentInstanceId, companyId)
    .first<{ role: string }>();
  if (!row) {
    throw new TeamMemberNotFoundError(agentInstanceId, companyId);
  }
  if (row.role !== "worker") {
    throw new TeamMemberNotPausableError(row.role);
  }
};

type SetMemberStatusInput = {
  activityType: "MEMBER_PAUSED" | "MEMBER_RESUMED";
  actorId: string | null;
  status: "active" | "paused";
};

const setMemberStatus = async (
  db: D1Database,
  companyId: string,
  agentInstanceId: string,
  input: SetMemberStatusInput,
): Promise<TeamMemberView> => {
  // oxlint-disable-next-line react-doctor/async-parallel -- ordered: assert, then update, then log and read back the committed row
  await assertMemberPausable(db, companyId, agentInstanceId);
  await db
    .prepare("UPDATE agent_instance SET status = ?, updated_at = ? WHERE id = ? AND company_id = ?")
    .bind(input.status, Date.now(), agentInstanceId, companyId)
    .run();
  await logActivity(
    { DB: db },
    {
      actorId: input.actorId ?? undefined,
      companyId,
      refId: agentInstanceId,
      refType: "agent_instance",
      summary: input.status === "paused" ? "Agente pausado." : "Agente retomado.",
      type: input.activityType,
    },
  );
  const detail = await getMemberDetail(db, companyId, agentInstanceId);
  if (!detail) {
    logError("team.setMemberStatus.readBack.missing", {
      agentInstanceId,
      companyId,
    });
    throw new Error("setMemberStatus: read-back failed");
  }
  return projectMemberView(detail);
};

const pauseMember = (
  db: D1Database,
  companyId: string,
  agentInstanceId: string,
  actorId: string | null = null,
) =>
  setMemberStatus(db, companyId, agentInstanceId, {
    activityType: "MEMBER_PAUSED",
    actorId,
    status: "paused",
  });

const resumeMember = (
  db: D1Database,
  companyId: string,
  agentInstanceId: string,
  actorId: string | null = null,
) =>
  setMemberStatus(db, companyId, agentInstanceId, {
    activityType: "MEMBER_RESUMED",
    actorId,
    status: "active",
  });

type UpdateInput = {
  agentInstanceId: string;
  companyId: string;
  displayName: string | undefined;
  editedBy: "customer" | "operator";
  operatorId: string | null;
  promptOverride: string | null | undefined;
};

const updateMember = async (db: D1Database, input: UpdateInput): Promise<TeamMemberView> => {
  const existing = await db
    .prepare(
      "SELECT display_name, prompt_override FROM agent_instance WHERE id = ? AND company_id = ?",
    )
    .bind(input.agentInstanceId, input.companyId)
    .first<{ display_name: string; prompt_override: string | null }>();
  if (!existing) {
    throw new TeamMemberNotFoundError(input.agentInstanceId, input.companyId);
  }

  const sets: Array<string> = [];
  const binds: Array<string | number | null> = [];
  let renameLog: { newName: string; oldName: string } | null = null;
  let promptLog: "MEMBER_PROMPT_EDITED" | "MEMBER_PROMPT_RESET" | null = null;
  let nextLength: number | null = null;

  if (input.displayName !== undefined) {
    const trimmed = input.displayName.trim();
    if (trimmed.length === 0) {
      throw new Error("displayName cannot be empty");
    }
    if (trimmed !== existing.display_name) {
      sets.push("display_name = ?");
      binds.push(trimmed);
      renameLog = { newName: trimmed, oldName: existing.display_name };
    }
  }

  if (input.promptOverride !== undefined) {
    const trimmedPrompt =
      typeof input.promptOverride === "string" ? input.promptOverride.trim() : null;
    if (input.promptOverride === null || trimmedPrompt === "") {
      sets.push("prompt_override = NULL");
      promptLog = "MEMBER_PROMPT_RESET";
    } else {
      sets.push("prompt_override = ?");
      binds.push(input.promptOverride);
      promptLog = "MEMBER_PROMPT_EDITED";
      nextLength = input.promptOverride.length;
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = ?");
    binds.push(Date.now(), input.agentInstanceId, input.companyId);
    await db
      .prepare(`UPDATE agent_instance SET ${sets.join(", ")} WHERE id = ? AND company_id = ?`)
      .bind(...binds)
      .run();
  }

  if (renameLog) {
    await logActivity(
      { DB: db },
      {
        actorId: input.operatorId ?? undefined,
        companyId: input.companyId,
        payload: renameLog,
        refId: input.agentInstanceId,
        refType: "agent_instance",
        summary: `Renomeado de "${renameLog.oldName}" para "${renameLog.newName}".`,
        type: "MEMBER_RENAMED",
      },
    );
  }
  if (promptLog === "MEMBER_PROMPT_EDITED") {
    await logActivity(
      { DB: db },
      {
        actorId: input.operatorId ?? undefined,
        companyId: input.companyId,
        payload: { editedBy: input.editedBy, length: nextLength },
        refId: input.agentInstanceId,
        refType: "agent_instance",
        summary: "Prompt personalizado atualizado.",
        type: "MEMBER_PROMPT_EDITED",
      },
    );
  } else if (promptLog === "MEMBER_PROMPT_RESET") {
    await logActivity(
      { DB: db },
      {
        actorId: input.operatorId ?? undefined,
        companyId: input.companyId,
        payload: { editedBy: input.editedBy },
        refId: input.agentInstanceId,
        refType: "agent_instance",
        summary: "Prompt restaurado ao padrão do template.",
        type: "MEMBER_PROMPT_RESET",
      },
    );
  }

  const detail = await getMemberDetail(db, input.companyId, input.agentInstanceId);
  if (!detail) {
    logError("team.updateMember.readBack.missing", {
      agentInstanceId: input.agentInstanceId,
      companyId: input.companyId,
    });
    throw new Error("updateMember: read-back failed");
  }
  return projectMemberView(detail);
};

export { hireMember, pauseMember, resumeMember, updateMember };
export {
  CorrespondentMissingError,
  TeamMemberNotFoundError,
  TeamMemberNotPausableError,
  TemplateNotFoundError,
  TemplateRetiredError,
} from "#/team/errors";
export type { UpdateInput };
