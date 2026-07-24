import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { emitTeamEvent, subscribeTeamEvents } from "#/team/events";

describe("team events DO fan-out", () => {
  it("delivers a broadcast to an open SSE subscriber", async () => {
    const companyId = "co_team_events_fanout";
    const controller = new AbortController();
    const response = await subscribeTeamEvents(env, companyId, controller.signal);
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toMatch(/text\/event-stream/v);

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("SSE body missing");
    }
    const decoder = new TextDecoder();
    let buffer = "";

    const readUntil = (needle: string): Promise<string> => {
      const step = async (): Promise<string> => {
        if (buffer.includes(needle)) {
          return buffer;
        }
        const { done, value } = await reader.read();
        if (done) {
          throw new Error(`SSE closed before "${needle}"; got: ${buffer}`);
        }
        buffer += decoder.decode(value, { stream: true });
        return step();
      };
      return step();
    };

    await readUntil(": connected");

    await emitTeamEvent(env, {
      companyId,
      reason: "hired",
      type: "team:roster",
    });

    const body = await readUntil("event: team:roster");
    expect(body).toContain('"reason":"hired"');
    expect(body).toContain(`"companyId":"${companyId}"`);

    controller.abort();
    await reader.cancel().catch(() => undefined);
  });
});
