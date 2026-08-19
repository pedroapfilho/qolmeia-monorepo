import type { OperatorAssignmentKind, PrismaClient } from "@repo/db";
import { correspondentIdFor, teamIdFor, workerIdFor } from "@repo/worker-api/contracts";
import type {
  MaterializeResult,
  OperatorCoverage,
  TeamMemberView,
  Template,
} from "@repo/worker-api/contracts";
import type { TeamStatusInput, TeamUpdateInput } from "@repo/worker-api/internal";

import { logActivity } from "./actions";
import { getCustomerCompany } from "./companies";
import { getTeamMember, getTeamRoster } from "./team-read";
import { assertTemplatesEntitled, getTemplate, isTemplateEntitled } from "./templates";
import { AgentDataError } from "./types";

const normalizeDisplayName = (value: string): string => value.toLocaleLowerCase("pt-BR");

type MemberUpdateData = {
  displayName?: string;
  promptOverride?: string | null;
};

const settleValues = async <Value>(
  operations: ReadonlyArray<Promise<Value>>,
): Promise<Array<Value>> => {
  const results = await Promise.allSettled(operations);
  return results.map((result) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    throw result.reason instanceof Error ? result.reason : new Error(String(result.reason));
  });
};

const nextDisplayName = (base: string, existing: ReadonlyArray<string>): string => {
  const taken = new Set(existing.map(normalizeDisplayName));
  if (!taken.has(normalizeDisplayName(base))) {
    return base;
  }
  for (let index = 2; index < 1000; index++) {
    const candidate = `${base} #${index}`;
    if (!taken.has(normalizeDisplayName(candidate))) {
      return candidate;
    }
  }
  throw new Error(`nextDisplayName: exhausted candidates for "${base}"`);
};

const materializeTeam = async (
  db: PrismaClient,
  input: { companyId: string; templateIds: ReadonlyArray<string> },
): Promise<MaterializeResult> => {
  if (input.templateIds.length === 0) {
    throw new Error("materializeTeam requires at least one templateId");
  }
  const templateRows = await settleValues(
    input.templateIds.map((templateId) => getTemplate(db, templateId)),
  );
  const templates = templateRows.map((template, index): Template => {
    if (!template) {
      throw new Error(`Template ${input.templateIds[index] ?? "unknown"} not found`);
    }
    return template;
  });
  await assertTemplatesEntitled(db, input.companyId, input.templateIds);

  const correspondentId = correspondentIdFor(input.companyId);
  const workerIds = templates.map(({ id }) => workerIdFor(id, input.companyId));
  const teamId = teamIdFor(input.companyId);

  await db.$transaction(async (tx) => {
    await tx.team.upsert({
      create: { companyId: input.companyId, confirmedAt: new Date(), id: teamId },
      update: { confirmedAt: new Date() },
      where: { companyId: input.companyId },
    });
    await tx.agentInstance.upsert({
      create: {
        companyId: input.companyId,
        displayName: "Correspondente",
        id: correspondentId,
        role: "correspondent",
      },
      update: {},
      where: { id: correspondentId },
    });
    await settleValues(
      templates.map((template, index) => {
        const id = workerIds[index];
        if (id === undefined) {
          throw new Error(`Missing worker id for template ${template.id}`);
        }
        return tx.agentInstance.upsert({
          create: {
            companyId: input.companyId,
            displayName: template.displayName,
            id,
            role: "worker",
            templateId: template.id,
            templateVersion: template.version,
          },
          update: {},
          where: { id },
        });
      }),
    );
    await tx.teamMember.upsert({
      create: { agentInstanceId: correspondentId, canDelegateTo: workerIds, teamId },
      update: { canDelegateTo: workerIds },
      where: { teamId_agentInstanceId: { agentInstanceId: correspondentId, teamId } },
    });
    await settleValues(
      workerIds.map((agentInstanceId) =>
        tx.teamMember.upsert({
          create: { agentInstanceId, canDelegateTo: [], teamId },
          update: {},
          where: { teamId_agentInstanceId: { agentInstanceId, teamId } },
        }),
      ),
    );
    await tx.company.update({ data: { status: "active" }, where: { id: input.companyId } });
  });
  return { correspondentId, teamId, workerIds };
};

const confirmTeam = async (
  db: PrismaClient,
  input: { actorId: string; companyId: string; templateIds: ReadonlyArray<string> },
) => {
  const company = await getCustomerCompany(db, input.companyId);
  if (!company) {
    throw new AgentDataError("company_not_found", "company not found", 404);
  }
  const team = await materializeTeam(db, input);
  await logActivity(db, {
    actorId: input.actorId,
    companyId: input.companyId,
    payload: {
      correspondentId: team.correspondentId,
      teamId: team.teamId,
      templateIds: [...input.templateIds],
      workerIds: [...team.workerIds],
    },
    refId: team.teamId,
    refType: "team",
    summary: "Time confirmado.",
    type: "TEAM_CONFIRMED",
  });
  return { brief: company.brief, team };
};

const hireMember = async (
  db: PrismaClient,
  input: {
    actorId: string | null;
    companyId: string;
    displayName?: string;
    templateId: string;
  },
): Promise<TeamMemberView> => {
  const template = await getTemplate(db, input.templateId);
  if (!template || !(await isTemplateEntitled(db, input.companyId, input.templateId))) {
    throw new AgentDataError("template_not_found", `template ${input.templateId} not found`, 404);
  }
  if (template.status !== "active") {
    throw new AgentDataError("template_retired", `template ${input.templateId} is retired`, 409);
  }
  const existingRoster = await getTeamRoster(db, input.companyId);
  const trimmedName = input.displayName?.trim();
  const displayName =
    trimmedName !== undefined && trimmedName.length > 0
      ? trimmedName
      : nextDisplayName(
          template.displayName,
          existingRoster.map((member) => member.displayName),
        );
  const agentInstanceId = `wkr_${crypto.randomUUID()}`;
  const teamId = teamIdFor(input.companyId);
  const correspondentId = correspondentIdFor(input.companyId);

  await db.$transaction(async (tx) => {
    const correspondent = await tx.teamMember.findUnique({
      where: { teamId_agentInstanceId: { agentInstanceId: correspondentId, teamId } },
    });
    if (!correspondent) {
      throw new AgentDataError(
        "correspondent_missing",
        `correspondent team_member missing for ${input.companyId}`,
        500,
      );
    }
    const targets = Array.isArray(correspondent.canDelegateTo)
      ? correspondent.canDelegateTo.filter((value): value is string => typeof value === "string")
      : [];
    await tx.agentInstance.create({
      data: {
        companyId: input.companyId,
        displayName,
        id: agentInstanceId,
        role: "worker",
        templateId: template.id,
        templateVersion: template.version,
      },
    });
    await tx.teamMember.create({ data: { agentInstanceId, canDelegateTo: [], teamId } });
    await tx.teamMember.update({
      data: { canDelegateTo: [...targets, agentInstanceId] },
      where: { teamId_agentInstanceId: { agentInstanceId: correspondentId, teamId } },
    });
  });
  await logActivity(db, {
    actorId: input.actorId ?? undefined,
    companyId: input.companyId,
    payload: { displayName, templateId: template.id },
    refId: agentInstanceId,
    refType: "agent_instance",
    summary: `Agente "${displayName}" contratado.`,
    type: "MEMBER_HIRED",
  });
  const member = await getTeamMember(db, input.companyId, agentInstanceId);
  if (!member) {
    throw new Error("hireMember: failed to read back the new member");
  }
  return member;
};

const setMemberStatus = async (
  db: PrismaClient,
  input: TeamStatusInput,
): Promise<TeamMemberView> => {
  const row = await db.agentInstance.findFirst({
    select: { role: true },
    where: { companyId: input.companyId, id: input.agentInstanceId },
  });
  if (!row) {
    throw new AgentDataError("member_not_found", "not found", 404);
  }
  if (row.role !== "worker") {
    throw new AgentDataError("member_not_pausable", `cannot pause/resume a ${row.role}`, 409);
  }
  await db.agentInstance.updateMany({
    data: { status: input.status },
    where: { companyId: input.companyId, id: input.agentInstanceId },
  });
  await logActivity(db, {
    actorId: input.actorId ?? undefined,
    companyId: input.companyId,
    refId: input.agentInstanceId,
    refType: "agent_instance",
    summary: input.status === "active" ? "Agente retomado." : "Agente pausado.",
    type: input.status === "active" ? "MEMBER_RESUMED" : "MEMBER_PAUSED",
  });
  const member = await getTeamMember(db, input.companyId, input.agentInstanceId);
  if (!member) {
    throw new Error("setMemberStatus: read-back failed");
  }
  return member;
};

const updateMember = async (db: PrismaClient, input: TeamUpdateInput): Promise<TeamMemberView> => {
  const existing = await db.agentInstance.findFirst({
    select: { displayName: true, promptOverride: true },
    where: { companyId: input.companyId, id: input.agentInstanceId },
  });
  if (!existing) {
    throw new AgentDataError("member_not_found", "not found", 404);
  }
  const data: MemberUpdateData = {};
  if (input.displayName !== undefined) {
    const displayName = input.displayName.trim();
    if (displayName.length === 0) {
      throw new AgentDataError("invalid_display_name", "displayName cannot be empty", 400);
    }
    if (displayName !== existing.displayName) {
      data.displayName = displayName;
      await logActivity(db, {
        actorId: input.operatorId ?? undefined,
        companyId: input.companyId,
        payload: { newName: displayName, oldName: existing.displayName },
        refId: input.agentInstanceId,
        refType: "agent_instance",
        summary: `Renomeado de "${existing.displayName}" para "${displayName}".`,
        type: "MEMBER_RENAMED",
      });
    }
  }
  if (input.promptOverride !== undefined) {
    const trimmedPrompt = input.promptOverride?.trim();
    const promptOverride =
      trimmedPrompt === undefined || trimmedPrompt === "" ? null : trimmedPrompt;
    data.promptOverride = promptOverride;
    await logActivity(db, {
      actorId: input.operatorId ?? undefined,
      companyId: input.companyId,
      payload:
        promptOverride === null
          ? { editedBy: input.editedBy }
          : { editedBy: input.editedBy, length: input.promptOverride?.length ?? 0 },
      refId: input.agentInstanceId,
      refType: "agent_instance",
      summary:
        promptOverride === null
          ? "Prompt restaurado ao padrão do template."
          : "Prompt personalizado atualizado.",
      type: promptOverride === null ? "MEMBER_PROMPT_RESET" : "MEMBER_PROMPT_EDITED",
    });
  }
  if (Object.keys(data).length > 0) {
    await db.agentInstance.updateMany({
      data,
      where: { companyId: input.companyId, id: input.agentInstanceId },
    });
  }
  const member = await getTeamMember(db, input.companyId, input.agentInstanceId);
  if (!member) {
    throw new Error("updateMember: read-back failed");
  }
  return member;
};

const setCoverage = async (
  db: PrismaClient,
  operatorUserId: string,
  coverage: OperatorCoverage,
): Promise<void> => {
  const rows: ReadonlyArray<{ kind: OperatorAssignmentKind; value: string }> = [
    ...coverage.companies.map((value) => ({ kind: "company" as const, value })),
    ...coverage.disciplines.map((value) => ({ kind: "discipline" as const, value })),
  ];
  await db.$transaction(async (tx) => {
    await tx.operatorAssignment.deleteMany({ where: { operatorUserId } });
    if (rows.length > 0) {
      await tx.operatorAssignment.createMany({
        data: rows.map((row) => ({
          id: crypto.randomUUID(),
          kind: row.kind,
          operatorUserId,
          value: row.value,
        })),
        skipDuplicates: true,
      });
    }
  });
};

export { confirmTeam, hireMember, setCoverage, setMemberStatus, updateMember };
