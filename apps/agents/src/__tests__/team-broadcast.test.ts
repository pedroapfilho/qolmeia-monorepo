import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { CorrespondentAgent } from "@/agents/correspondent";

const COMPANY_ID = "co_broadcast_test";

describe("CorrespondentAgent.broadcastTeamEvent", () => {
  it("sends a JSON frame to all connected WebSocket peers", async () => {
    const stub = env.CORRESPONDENT.get(env.CORRESPONDENT.idFromName(COMPANY_ID));
    const sent: Array<string> = [];
    await runInDurableObject(stub, async (instance: InstanceType<typeof CorrespondentAgent>) => {
      // Inject a fake getConnections seam so we can capture the send call.
      (
        instance as unknown as {
          getConnections: () => Array<{ send: (m: string) => void }>;
        }
      ).getConnections = () => [{ send: (msg: string) => sent.push(msg) }];
      await instance.broadcastTeamEvent({
        companyId: COMPANY_ID,
        reason: "ticket_changed",
        type: "team:status",
      });
    });
    expect(sent).toHaveLength(1);
    const decoded = JSON.parse(sent[0]!) as { reason: string; type: string };
    expect(decoded.type).toBe("team:status");
    expect(decoded.reason).toBe("ticket_changed");
  });
});
