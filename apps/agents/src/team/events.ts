// Team roster/status change events. These were broadcast to the Correspondent
// DO's connected WebSocket peers for live backoffice/client updates. That DO and
// its WS surface are gone with the Flue migration; the real-time push will be
// rebuilt on the SSE transport. Until then `emitTeamEvent` is a no-op so callers
// stay wired without a dead Durable Object dependency.
type TeamEvent =
  | {
      companyId: string;
      reason: "ticket_changed" | "instance_changed";
      type: "team:status";
    }
  | {
      companyId: string;
      reason: "hired" | "paused" | "resumed" | "renamed" | "prompt_changed";
      type: "team:roster";
    };

const emitTeamEvent = async (_env: Env, _event: TeamEvent): Promise<void> => {
  // No-op until live team updates are rebuilt on SSE.
};

export { emitTeamEvent };
export type { TeamEvent };
