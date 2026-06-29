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

const emitTeamEvent = async (_env: Env, _event: TeamEvent): Promise<void> => {};

export { emitTeamEvent };
export type { TeamEvent };
