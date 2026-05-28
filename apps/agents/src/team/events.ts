import { getAgentByName } from "agents";

import type { TeamEvent } from "@/agents/correspondent";
import { logError } from "@/lib/logger";

const emitTeamEvent = async (env: Env, event: TeamEvent): Promise<void> => {
  try {
    const stub = await getAgentByName(env.CORRESPONDENT, event.companyId);
    await stub.broadcastTeamEvent(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("team.event.emit.err", {
      companyId: event.companyId,
      error: message,
      type: event.type,
    });
  }
};

export { emitTeamEvent };
