import { DurableObject } from "cloudflare:workers";

import type { TeamEvent } from "#/team/events";

type TeamEventSubscriber = {
  close: () => void;
  send: (chunk: string) => void;
};

class TeamEvents extends DurableObject<Env> {
  readonly #subscribers = new Set<TeamEventSubscriber>();

  // fallow-ignore-next-line unused-class-member -- invoked through the DurableObjectStub in team/events.ts
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = await request.json<TeamEvent>();
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
    const dead: Array<TeamEventSubscriber> = [];

    for (const subscriber of this.#subscribers) {
      try {
        subscriber.send(chunk);
      } catch {
        dead.push(subscriber);
      }
    }

    for (const subscriber of dead) {
      this.#subscribers.delete(subscriber);
      subscriber.close();
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
              // noop
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
