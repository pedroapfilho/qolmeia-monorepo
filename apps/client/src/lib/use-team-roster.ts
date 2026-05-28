"use client";

import { useAgent } from "agents/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AGENTS_URL, fetchTeam, type TeamMemberView } from "@/lib/team";

const POLL_INTERVAL_MS = 30_000;

type Status = "idle" | "loading" | "ready" | "error";

type UseTeamRosterResult = {
  error: Error | null;
  members: Array<TeamMemberView>;
  refetch: () => Promise<void>;
  status: Status;
};

const isTeamFrame = (payload: unknown): boolean => {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const type = (payload as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("team:");
};

const useTeamRoster = (companyId: string, sessionToken: string): UseTeamRosterResult => {
  const [members, setMembers] = useState<Array<TeamMemberView>>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<Error | null>(null);
  const wsOpenRef = useRef(false);

  const refetch = useCallback(async () => {
    setStatus("loading");
    try {
      const next = await fetchTeam();
      setMembers(next);
      setError(null);
      setStatus("ready");
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError : new Error(String(fetchError)));
      setStatus("error");
    }
  }, []);

  // Initial load — calling an async state-updating function from useEffect is
  // the intended data-fetching pattern here; the lint rule targets direct
  // setState() calls, not async fetch helpers.
  useEffect(() => {
    // oxlint-disable-next-line react-hooks-js/set-state-in-effect
    refetch();
  }, [refetch]);

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
        refetch();
      }
    },
    onOpen: () => {
      wsOpenRef.current = true;
    },
    query: { cf_session: sessionToken },
  });

  // visibilitychange → refetch once when becoming visible
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        refetch();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refetch]);

  // 30s safety poll only when the socket is closed
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!wsOpenRef.current) {
        refetch();
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refetch]);

  return { error, members, refetch, status };
};

export { useTeamRoster };
export type { UseTeamRosterResult };
