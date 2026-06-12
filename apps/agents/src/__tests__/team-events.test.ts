import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { CorrespondentAgent } from "@/agents/correspondent";
import { emitTeamEvent } from "@/team/events";

const COMPANY_ID = "co_emit_test";

describe("emitTeamEvent", () => {
  it("calls broadcastTeamEvent on the correct CorrespondentAgent DO", async () => {
    const stub = env.CORRESPONDENT.get(env.CORRESPONDENT.idFromName(COMPANY_ID));
    const received: Array<string> = [];
    await runInDurableObject(stub, async (instance: InstanceType<typeof CorrespondentAgent>) => {
      (
        instance as unknown as { getConnections: () => Array<{ send: (m: string) => void }> }
      ).getConnections = () => [{ send: (m: string) => received.push(m) }];
      await Promise.resolve();
    });
    await emitTeamEvent(env, {
      companyId: COMPANY_ID,
      reason: "hired",
      type: "team:roster",
    });
    // The send happens inside the DO, so re-enter to read the captured frames.
    await runInDurableObject(stub, async () => {
      await Promise.resolve();
    });
    expect(received).toEqual([
      JSON.stringify({ companyId: COMPANY_ID, reason: "hired", type: "team:roster" }),
    ]);
  });

  it("swallows errors when the DO is unreachable", async () => {
    await expect(
      emitTeamEvent(
        { ...env, CORRESPONDENT: undefined as unknown as typeof env.CORRESPONDENT },
        {
          companyId: "anything",
          reason: "hired",
          type: "team:roster",
        },
      ),
    ).resolves.toBeUndefined();
  });
});
