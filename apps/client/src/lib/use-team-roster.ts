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

// Live team:roster/status broadcasts came over the correspondent DO's
// WebSocket, which Flue removes (no DO, no socket). For now the roster refreshes
// on a fixed safety poll + window focus; the previous socket-gated polling is
// gone.
// TODO: live updates via Flue SSE/channels once the Worker exposes a roster
// event stream.
const useTeamRoster = (companyId: string, _sessionToken: string): UseTeamRosterResult => {
  // Destructure only the fields we read so TanStack's tracked-property
  // optimization can skip re-renders for fields this hook ignores.
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
    // Always refresh when the tab becomes visible again.
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
