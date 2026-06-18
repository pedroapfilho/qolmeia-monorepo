"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAgent } from "agents/react";
import { useState } from "react";

import { AGENTS_URL, fetchTeam, type TeamMemberView } from "@/lib/team";

const POLL_INTERVAL_MS = 30_000;

const teamQueryKey = (companyId: string) => ["team", companyId] as const;

type RosterStatus = "error" | "loading" | "ready";

type UseTeamRosterResult = {
  error: Error | null;
  members: Array<TeamMemberView>;
  refetch: () => Promise<void>;
  status: RosterStatus;
};

const isTeamFrame = (payload: unknown): boolean => {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const type = (payload as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("team:");
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

const useTeamRoster = (companyId: string, sessionToken: string): UseTeamRosterResult => {
  const queryClient = useQueryClient();
  // State (not a ref): TanStack only recomputes refetchInterval when the
  // observer's options or result change, so a socket drop must re-render
  // the hook for the safety poll to re-arm.
  const [isSocketOpen, setIsSocketOpen] = useState(false);

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
    // The WebSocket is the primary invalidation channel; the 30s interval is
    // a safety poll that only runs while the socket is down.
    refetchInterval: isSocketOpen ? false : POLL_INTERVAL_MS,
    // Always refresh when the tab becomes visible again (the socket may have
    // silently dropped while backgrounded).
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  // Subscribe to the correspondent DO's WebSocket for team:* invalidation pings.
  useAgent({
    agent: "correspondent",
    host: AGENTS_URL,
    name: companyId,
    onClose: () => {
      setIsSocketOpen(false);
    },
    onMessage: (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (isTeamFrame(parsed)) {
        void queryClient.invalidateQueries({ queryKey: teamQueryKey(companyId) });
      }
    },
    onOpen: () => {
      setIsSocketOpen(true);
    },
    query: { cf_session: sessionToken },
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
