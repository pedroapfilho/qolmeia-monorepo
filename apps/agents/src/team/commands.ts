import type { PrismaClient } from "@repo/db/worker";
import type { TeamMemberView } from "@repo/worker-api/contracts";
import { z } from "zod";

import { emitTeamEvent } from "#/team/events";
import { hireMember, setMemberStatus, updateMember, type UpdateInput } from "#/team/mutations";

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

const runTeamCommand = async (
  env: Env,
  companyId: string,
  reason: "hired" | "paused" | "prompt_changed" | "renamed" | "resumed",
  mutation: () => Promise<TeamMemberView>,
): Promise<TeamMemberView> => {
  const member = await mutation();
  await emitTeamEvent(env, { companyId, reason, type: "team:roster" });
  return member;
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

const STATUS_EVENT_REASON = { active: "resumed", paused: "paused" } as const;

const setTeamMemberStatus = (
  env: Env,
  db: PrismaClient,
  input: SetTeamMemberStatusInput,
): Promise<TeamMemberView> =>
  runTeamCommand(env, input.companyId, STATUS_EVENT_REASON[input.status], () =>
    setMemberStatus(db, input),
  );

export {
  backofficeTeamMemberPatchSchema,
  hireTeamMember,
  hireTeamMemberSchema,
  setTeamMemberStatus,
  teamMemberPatchSchema,
  updateTeamMember,
};
