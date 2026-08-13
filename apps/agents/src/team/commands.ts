import type { PrismaClient } from "@repo/db/worker";
import { z } from "zod";

import { emitTeamEvent } from "#/team/events";
import {
  CorrespondentMissingError,
  hireMember,
  pauseMember,
  resumeMember,
  TeamMemberNotFoundError,
  TeamMemberNotPausableError,
  TemplateNotFoundError,
  TemplateRetiredError,
  updateMember,
  type UpdateInput,
} from "#/team/mutations";
import type { TeamMemberView } from "#/team/types";

type TeamCommandErrorCode =
  | "correspondent_missing"
  | "member_not_found"
  | "member_not_pausable"
  | "template_not_found"
  | "template_retired";

class TeamCommandError extends Error {
  readonly code: TeamCommandErrorCode;

  constructor(code: TeamCommandErrorCode, message: string, cause: Error) {
    super(message, { cause });
    this.code = code;
    this.name = "TeamCommandError";
  }
}

const teamMemberPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  promptOverride: z.union([z.string().trim().min(1).max(20_000), z.null()]).optional(),
});

const backofficeTeamMemberPatchSchema = teamMemberPatchSchema.extend({
  status: z.enum(["active", "paused"]).optional(),
});

const hireTeamMemberSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  templateId: z.string().min(1),
});

const toTeamCommandError = (error: Error): TeamCommandError | null => {
  if (error instanceof TeamMemberNotPausableError) {
    return new TeamCommandError("member_not_pausable", error.message, error);
  }
  if (error instanceof TeamMemberNotFoundError) {
    return new TeamCommandError("member_not_found", "not found", error);
  }
  if (error instanceof TemplateNotFoundError) {
    return new TeamCommandError("template_not_found", error.message, error);
  }
  if (error instanceof TemplateRetiredError) {
    return new TeamCommandError("template_retired", error.message, error);
  }
  if (error instanceof CorrespondentMissingError) {
    return new TeamCommandError("correspondent_missing", error.message, error);
  }
  return null;
};

const runTeamCommand = async (
  env: Env,
  companyId: string,
  reason: "hired" | "paused" | "prompt_changed" | "renamed" | "resumed",
  mutation: () => Promise<TeamMemberView>,
): Promise<TeamMemberView> => {
  try {
    const member = await mutation();
    await emitTeamEvent(env, { companyId, reason, type: "team:roster" });
    return member;
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    const commandError = toTeamCommandError(error);
    if (commandError) {
      throw commandError;
    }
    throw error;
  }
};

type HireTeamMemberInput = {
  actorId: string;
  companyId: string;
  displayName: string | undefined;
  templateId: string;
};

const hireTeamMember = (
  env: Env,
  db: PrismaClient,
  input: HireTeamMemberInput,
): Promise<TeamMemberView> =>
  runTeamCommand(env, input.companyId, "hired", () => hireMember(db, input));

const updateTeamMember = (
  env: Env,
  db: PrismaClient,
  input: UpdateInput,
): Promise<TeamMemberView> =>
  runTeamCommand(
    env,
    input.companyId,
    input.promptOverride === undefined ? "renamed" : "prompt_changed",
    () => updateMember(db, input),
  );

type SetTeamMemberStatusInput = {
  actorId: string;
  agentInstanceId: string;
  companyId: string;
  status: "active" | "paused";
};

const setTeamMemberStatus = (
  env: Env,
  db: PrismaClient,
  input: SetTeamMemberStatusInput,
): Promise<TeamMemberView> => {
  const paused = input.status === "paused";
  return runTeamCommand(env, input.companyId, paused ? "paused" : "resumed", () =>
    paused
      ? pauseMember(db, input.companyId, input.agentInstanceId, input.actorId)
      : resumeMember(db, input.companyId, input.agentInstanceId, input.actorId),
  );
};

export {
  backofficeTeamMemberPatchSchema,
  hireTeamMember,
  hireTeamMemberSchema,
  setTeamMemberStatus,
  TeamCommandError,
  teamMemberPatchSchema,
  updateTeamMember,
};
