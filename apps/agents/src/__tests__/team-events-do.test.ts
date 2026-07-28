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

  it("still delivers to healthy subscribers when an earlier one is dead", async () => {
    const companyId = "co_team_events_dead_subscriber";
    const deadController = new AbortController();
    const liveController = new AbortController();

    const deadResponse = await subscribeTeamEvents(env, companyId, deadController.signal);
    const liveResponse = await subscribeTeamEvents(env, companyId, liveController.signal);

    const deadReader = deadResponse.body?.getReader();
    const liveReader = liveResponse.body?.getReader();
    if (!deadReader || !liveReader) {
      throw new Error("SSE body missing");
    }

    const decoder = new TextDecoder();
    await deadReader.read();
    await liveReader.read();

    // Cancel without aborting the signal: the DO never learns the stream
    // is gone, so the next enqueue on it throws.
    await deadReader.cancel().catch(() => undefined);

    await emitTeamEvent(env, { companyId, reason: "hired", type: "team:roster" });

    const readUntilEvent = (): Promise<string> => {
      let buffer = "";
      const step = async (): Promise<string> => {
        if (buffer.includes("event: team:roster")) {
          return buffer;
        }
        const { done, value } = await liveReader.read();
        if (done) {
          throw new Error(`SSE closed before the event; got: ${buffer}`);
        }
        buffer += decoder.decode(value, { stream: true });
        return step();
      };
      return step();
    };

    expect(await readUntilEvent()).toContain('"reason":"hired"');

    liveController.abort();
    deadController.abort();
    await liveReader.cancel().catch(() => undefined);
  });
});
