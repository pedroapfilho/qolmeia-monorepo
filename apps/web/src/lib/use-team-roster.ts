"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { fetchTeam, subscribeTeamEvents, type TeamMemberView } from "@/lib/team";

const POLL_INTERVAL_MS = 30_000;

const teamQueryKey = (companyId: string) => ["team", companyId] as const;

type RosterStatus = "error" | "loading" | "ready";

type UseTeamRosterResult = {
  error: Error | null;
  members: Array<TeamMemberView>;
  refetch: () => Promise<void>;
  status: RosterStatus;
};

type TeamRosterDependencies = {
  fetchRoster: typeof fetchTeam;
  subscribeToTeamEvents: typeof subscribeTeamEvents;
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

const createUseTeamRoster = ({ fetchRoster, subscribeToTeamEvents }: TeamRosterDependencies) => {
  const useTeamRosterWithDependencies = (
    companyId: string,
    initialData?: Array<TeamMemberView>,
  ): UseTeamRosterResult => {
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => teamQueryKey(companyId), [companyId]);
    const {
      data,
      error,
      isError,
      isPending,
      refetch: queryRefetch,
    } = useQuery({
      initialData,
      meta: { errorToast: "Falha ao sincronizar time" },
      queryFn: fetchRoster,
      queryKey,
      refetchInterval: POLL_INTERVAL_MS,
      refetchOnMount: initialData === undefined,
      refetchOnWindowFocus: true,
      staleTime: 0,
    });

    useEffect(() => {
      const unsubscribe = subscribeToTeamEvents(() => {
        void queryClient.invalidateQueries({ queryKey });
      });
      return () => {
        unsubscribe?.();
      };
    }, [queryClient, queryKey]);

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

  return useTeamRosterWithDependencies;
};

const useTeamRoster = createUseTeamRoster({
  fetchRoster: fetchTeam,
  subscribeToTeamEvents: subscribeTeamEvents,
});

export { createUseTeamRoster, teamQueryKey, useTeamRoster };
export type { TeamRosterDependencies };
