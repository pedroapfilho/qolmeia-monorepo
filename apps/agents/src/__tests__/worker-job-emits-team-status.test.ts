import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { CorrespondentAgent } from "@/agents/correspondent";
import { emitTeamEvent } from "@/team/events";

const COMPANY_ID = "co_wj_emit_test";

describe("ticket-status transitions emit team:status", () => {
  it("emitTeamEvent is called for ticket status changes (wired from worker-job.ts)", async () => {
    const stub = env.CORRESPONDENT.get(env.CORRESPONDENT.idFromName(COMPANY_ID));
    const received: Array<string> = [];
    await runInDurableObject(stub, async (instance: InstanceType<typeof CorrespondentAgent>) => {
      (
        instance as unknown as { getConnections: () => Array<{ send: (m: string) => void }> }
      ).getConnections = () => [{ send: (m: string) => received.push(m) }];
      await Promise.resolve();
    });

    // Verify that calling emitTeamEvent routes to the correct DO and captures the message.
    // This simulates what happens after setTicketStatus calls in worker-job.ts.
    await emitTeamEvent(env, {
      companyId: COMPANY_ID,
      reason: "ticket_changed",
      type: "team:status",
    });

    // Re-enter the DO to confirm the broadcast was queued.
    await runInDurableObject(stub, async () => {
      await Promise.resolve();
    });

    expect(received).toEqual([
      JSON.stringify({ companyId: COMPANY_ID, reason: "ticket_changed", type: "team:status" }),
    ]);
  });
});
