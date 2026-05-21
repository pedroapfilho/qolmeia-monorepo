import type { Metadata } from "next";

import { TeamPageClient } from "@/components/team-page-client";
import { apiGetServer } from "@/lib/api-server";
import type { TeamMembersResponse } from "@/lib/api-types";

export const metadata: Metadata = { title: "Equipe" };

const TeamPage = async () => {
  const res = await apiGetServer<TeamMembersResponse>("/team/members");
  return <TeamPageClient members={res.items} />;
};

export default TeamPage;
