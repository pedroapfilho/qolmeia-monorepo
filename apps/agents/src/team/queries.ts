import type {
  HireableTemplate,
  TeamMemberDetailView,
  TeamMemberView,
} from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";

const listTeamRosters = async (
  db: Database,
  companyIds: ReadonlyArray<string>,
): Promise<Map<string, Array<TeamMemberView>>> => {
  const rosters = await db("teams.rosters", { companyIds });
  return new Map(Object.entries(rosters).map(([companyId, members]) => [companyId, [...members]]));
};

const getTeamRoster = async (db: Database, companyId: string): Promise<Array<TeamMemberView>> => [
  ...(await db("teams.roster", { companyId })),
];

const getCatalogue = async (db: Database, companyId: string): Promise<Array<HireableTemplate>> => [
  ...(await db("teams.catalogue", { companyId })),
];

const getMemberDetail = (
  db: Database,
  companyId: string,
  agentInstanceId: string,
): Promise<TeamMemberDetailView | null> => db("teams.memberDetail", { agentInstanceId, companyId });

export { getCatalogue, getMemberDetail, getTeamRoster, listTeamRosters };
export type {
  HireableTemplate,
  TeamMemberDetailView,
  TeamMemberView,
} from "@repo/worker-api/contracts";
