import { logError } from "#/lib/logger";

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

const stubFor = (env: Env, companyId: string) =>
  env.TEAM_EVENTS.get(env.TEAM_EVENTS.idFromName(companyId));

const emitTeamEvent = async (env: Env, event: TeamEvent): Promise<void> => {
  try {
    await stubFor(env, event.companyId).fetch(
      new Request("https://team-events/broadcast", {
        body: JSON.stringify(event),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
  } catch (error) {
    logError("team.event.emit.err", {
      companyId: event.companyId,
      error: error instanceof Error ? error.message : String(error),
      type: event.type,
    });
  }
};

const subscribeTeamEvents = (env: Env, companyId: string, signal: AbortSignal): Promise<Response> =>
  stubFor(env, companyId).fetch(new Request("https://team-events/subscribe", { signal }));

export { emitTeamEvent, subscribeTeamEvents };
export type { TeamEvent };
