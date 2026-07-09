import { DurableObject } from "cloudflare:workers";

import type { TeamEvent } from "#/team/events";

type TeamEventSubscriber = {
  close: () => void;
  send: (chunk: string) => void;
};

// One DO instance per companyId owns all open SSE subscribers for that
// company, so emits from Workflows / Flue agent DOs / any Worker isolate
// reach the same fan-out set.
class TeamEvents extends DurableObject<Env> {
  #subscribers = new Set<TeamEventSubscriber>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = (await request.json()) as TeamEvent;
      this.#broadcast(event);
      return new Response(null, { status: 204 });
    }
    if (request.method === "GET" && url.pathname === "/subscribe") {
      return this.#subscribe(request.signal);
    }
    return new Response("Not found", { status: 404 });
  }

  #broadcast(event: TeamEvent): void {
    const chunk = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const subscriber of this.#subscribers) {
      subscriber.send(chunk);
    }
  }

  #subscribe(signal: AbortSignal): Response {
    const encoder = new TextEncoder();
    let subscriber: TeamEventSubscriber;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const sendChunk = (chunk: string): void => {
          controller.enqueue(encoder.encode(chunk));
        };
        subscriber = {
          close: () => {
            try {
              controller.close();
            } catch {
              // The stream may already be closed by the client abort.
            }
          },
          send: sendChunk,
        };
        this.#subscribers.add(subscriber);
        sendChunk(": connected\n\n");

        signal.addEventListener(
          "abort",
          () => {
            this.#subscribers.delete(subscriber);
            subscriber.close();
          },
          { once: true },
        );
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "text/event-stream",
      },
    });
  }
}

export { TeamEvents };
