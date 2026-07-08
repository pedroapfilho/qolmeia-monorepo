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

type TeamEventSubscriber = {
  close: () => void;
  send: (event: TeamEvent) => void;
};

const subscribersByCompany = new Map<string, Set<TeamEventSubscriber>>();

const emitTeamEvent = async (_env: Env, event: TeamEvent): Promise<void> => {
  const subscribers = subscribersByCompany.get(event.companyId);
  if (!subscribers) {
    return;
  }
  for (const subscriber of subscribers) {
    subscriber.send(event);
  }
};

const subscribeTeamEvents = (companyId: string, signal: AbortSignal): Response => {
  const encoder = new TextEncoder();
  let subscriber: TeamEventSubscriber;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
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
        send: (event) => {
          sendChunk(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        },
      };
      const subscribers = subscribersByCompany.get(companyId) ?? new Set<TeamEventSubscriber>();
      subscribers.add(subscriber);
      subscribersByCompany.set(companyId, subscribers);
      sendChunk(": connected\n\n");

      signal.addEventListener(
        "abort",
        () => {
          subscribers.delete(subscriber);
          if (subscribers.size === 0) {
            subscribersByCompany.delete(companyId);
          }
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
};

export { emitTeamEvent, subscribeTeamEvents };
export type { TeamEvent };
