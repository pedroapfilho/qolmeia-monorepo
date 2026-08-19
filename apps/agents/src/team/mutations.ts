import type { TeamMemberView } from "@repo/worker-api/contracts";
import { AgentsApiError } from "@repo/worker-api/internal";

import type { Database } from "#/db/client";
import { RemoteTeamDomainError } from "#/team/errors";

type HireInput = {
  actorId: string | null;
  companyId: string;
  displayName: string | undefined;
  templateId: string;
};

type MemberStatus = "active" | "paused";

type SetMemberStatusInput = {
  actorId?: string | null;
  agentInstanceId: string;
  companyId: string;
  status: MemberStatus;
};

type UpdateInput = {
  agentInstanceId: string;
  companyId: string;
  displayName: string | undefined;
  editedBy: "customer" | "operator";
  operatorId: string | null;
  promptOverride: string | null | undefined;
};

const callTeam = async (request: Promise<TeamMemberView>): Promise<TeamMemberView> => {
  try {
    return await request;
  } catch (error) {
    if (error instanceof AgentsApiError && error.code !== null) {
      throw new RemoteTeamDomainError(error.code, error.message);
    }
    throw error;
  }
};

const hireMember = (db: Database, input: HireInput): Promise<TeamMemberView> =>
  callTeam(db("teams.hire", input));

const setMemberStatus = (db: Database, input: SetMemberStatusInput): Promise<TeamMemberView> =>
  callTeam(db("teams.setStatus", input));

const updateMember = (db: Database, input: UpdateInput): Promise<TeamMemberView> =>
  callTeam(db("teams.update", input));

export { hireMember, setMemberStatus, updateMember };
export type { MemberStatus, SetMemberStatusInput, UpdateInput };
