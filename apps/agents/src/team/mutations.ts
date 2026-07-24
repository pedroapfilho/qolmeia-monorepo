import type { PrismaClient } from "@repo/db/worker";

import { logActivity } from "#/activity/log";
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

const hireMember = async (db: PrismaClient, input: HireInput): Promise<TeamMemberView> => {
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
    trimmedName !== undefined && trimmedName.length > 0
      ? trimmedName
      : nextDisplayName(
          template.displayName,
          existingRoster.map((m) => m.displayName),
        );

  const newId = newWorkerId();

  const teamId = teamIdFor(input.companyId);
  const correspondentId = correspondentIdFor(input.companyId);

  const corrRow = await db.teamMember.findUnique({
    where: { teamId_agentInstanceId: { agentInstanceId: correspondentId, teamId } },
  });
  if (!corrRow) {
    throw new CorrespondentMissingError(input.companyId);
  }
  const targets = Array.isArray(corrRow.canDelegateTo)
    ? corrRow.canDelegateTo.filter((value): value is string => typeof value === "string")
    : [];
  const updatedTargets = [...targets, newId];

  // oxlint-disable-next-line react-doctor/async-parallel -- ordered: activity log and read-back must observe the committed batch
  await db.$transaction(async (tx) => {
    await tx.agentInstance.create({
      data: {
        companyId: input.companyId,
        displayName: desiredName,
        id: newId,
        role: "worker",
        templateId: template.id,
        templateVersion: template.version,
      },
    });
    await tx.teamMember.create({
      data: { agentInstanceId: newId, canDelegateTo: [], teamId },
    });
    await tx.teamMember.update({
      data: { canDelegateTo: updatedTargets },
      where: { teamId_agentInstanceId: { agentInstanceId: correspondentId, teamId } },
    });
  });

  await logActivity(db, {
    actorId: input.actorId ?? undefined,
    companyId: input.companyId,
    payload: { displayName: desiredName, templateId: template.id },
    refId: newId,
    refType: "agent_instance",
    summary: `Agente "${desiredName}" contratado.`,
    type: "MEMBER_HIRED",
  });

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
  db: PrismaClient,
  companyId: string,
  agentInstanceId: string,
): Promise<void> => {
  const row = await db.agentInstance.findFirst({
    select: { role: true },
    where: { companyId, id: agentInstanceId },
  });
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
  db: PrismaClient,
  companyId: string,
  agentInstanceId: string,
  input: SetMemberStatusInput,
): Promise<TeamMemberView> => {
  // oxlint-disable-next-line react-doctor/async-parallel -- ordered: assert, then update, then log and read back the committed row
  await assertMemberPausable(db, companyId, agentInstanceId);
  await db.agentInstance.updateMany({
    data: { status: input.status },
    where: { companyId, id: agentInstanceId },
  });
  await logActivity(db, {
    actorId: input.actorId ?? undefined,
    companyId,
    refId: agentInstanceId,
    refType: "agent_instance",
    summary: input.status === "paused" ? "Agente pausado." : "Agente retomado.",
    type: input.activityType,
  });
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
  db: PrismaClient,
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
  db: PrismaClient,
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

const updateMember = async (db: PrismaClient, input: UpdateInput): Promise<TeamMemberView> => {
  const existing = await db.agentInstance.findFirst({
    select: { displayName: true, promptOverride: true },
    where: { companyId: input.companyId, id: input.agentInstanceId },
  });
  if (!existing) {
    throw new TeamMemberNotFoundError(input.agentInstanceId, input.companyId);
  }

  const data: { displayName?: string; promptOverride?: string | null } = {};
  let renameLog: { newName: string; oldName: string } | null = null;
  let promptLog: "MEMBER_PROMPT_EDITED" | "MEMBER_PROMPT_RESET" | null = null;
  let nextLength: number | null = null;

  if (input.displayName !== undefined) {
    const trimmed = input.displayName.trim();
    if (trimmed.length === 0) {
      throw new Error("displayName cannot be empty");
    }
    if (trimmed !== existing.displayName) {
      data.displayName = trimmed;
      renameLog = { newName: trimmed, oldName: existing.displayName };
    }
  }

  if (input.promptOverride !== undefined) {
    const trimmedPrompt =
      typeof input.promptOverride === "string" ? input.promptOverride.trim() : null;
    if (input.promptOverride === null || trimmedPrompt === "") {
      data.promptOverride = null;
      promptLog = "MEMBER_PROMPT_RESET";
    } else {
      data.promptOverride = input.promptOverride;
      promptLog = "MEMBER_PROMPT_EDITED";
      nextLength = input.promptOverride.length;
    }
  }

  if (Object.keys(data).length > 0) {
    await db.agentInstance.updateMany({
      data,
      where: { companyId: input.companyId, id: input.agentInstanceId },
    });
  }

  if (renameLog) {
    await logActivity(db, {
      actorId: input.operatorId ?? undefined,
      companyId: input.companyId,
      payload: renameLog,
      refId: input.agentInstanceId,
      refType: "agent_instance",
      summary: `Renomeado de "${renameLog.oldName}" para "${renameLog.newName}".`,
      type: "MEMBER_RENAMED",
    });
  }
  if (promptLog === "MEMBER_PROMPT_EDITED") {
    await logActivity(db, {
      actorId: input.operatorId ?? undefined,
      companyId: input.companyId,
      payload: { editedBy: input.editedBy, length: nextLength },
      refId: input.agentInstanceId,
      refType: "agent_instance",
      summary: "Prompt personalizado atualizado.",
      type: "MEMBER_PROMPT_EDITED",
    });
  } else if (promptLog === "MEMBER_PROMPT_RESET") {
    await logActivity(db, {
      actorId: input.operatorId ?? undefined,
      companyId: input.companyId,
      payload: { editedBy: input.editedBy },
      refId: input.agentInstanceId,
      refType: "agent_instance",
      summary: "Prompt restaurado ao padrão do template.",
      type: "MEMBER_PROMPT_RESET",
    });
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
