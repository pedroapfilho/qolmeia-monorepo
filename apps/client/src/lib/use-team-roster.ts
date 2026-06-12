"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAgent } from "agents/react";
import { useRef } from "react";

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
  const wsOpenRef = useRef(false);

  const query = useQuery({
    meta: { errorToast: "Falha ao sincronizar time" },
    queryFn: fetchTeam,
    queryKey: teamQueryKey(companyId),
    // The WebSocket is the primary invalidation channel; the 30s interval is
    // a safety poll that only runs while the socket is down.
    refetchInterval: () => (wsOpenRef.current ? false : POLL_INTERVAL_MS),
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
      wsOpenRef.current = false;
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
      wsOpenRef.current = true;
    },
    query: { cf_session: sessionToken },
  });

  const refetch = async (): Promise<void> => {
    await query.refetch();
  };

  return {
    error: query.error,
    members: query.data ?? [],
    refetch,
    status: rosterStatus(query),
  };
};

export { useTeamRoster };
export type { UseTeamRosterResult };
