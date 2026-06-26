"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchTeam, type TeamMemberView } from "@/lib/team";

const POLL_INTERVAL_MS = 30_000;

const teamQueryKey = (companyId: string) => ["team", companyId] as const;

type RosterStatus = "error" | "loading" | "ready";

type UseTeamRosterResult = {
  error: Error | null;
  members: Array<TeamMemberView>;
  refetch: () => Promise<void>;
  status: RosterStatus;
};

const rosterStatus = (query: { isError: boolean; isPending: boolean }): RosterStatus => {
  if (query.isPending) {
    return "loading";
  }
  if (query.isError) {
    return "error";
  }
  return "ready";
};

const useTeamRoster = (companyId: string, _sessionToken: string): UseTeamRosterResult => {
  const {
    data,
    error,
    isError,
    isPending,
    refetch: queryRefetch,
  } = useQuery({
    meta: { errorToast: "Falha ao sincronizar time" },
    queryFn: fetchTeam,
    queryKey: teamQueryKey(companyId),
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const refetch = async (): Promise<void> => {
    await queryRefetch();
  };

  return {
    error,
    members: data ?? [],
    refetch,
    status: rosterStatus({ isError, isPending }),
  };
};

export { useTeamRoster };
export type { UseTeamRosterResult };
