import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/middleware/require-staff";
import type { CustomerContextVars } from "@/middleware/require-customer";

import { buildWebChatRoutes } from "./web-chat";

const session: AuthSession = {
  session: { id: "sess_1", userId: "user_1" },
  user: { email: "c@example.com", id: "user_1", name: "Cliente" },
};

const buildAppWithGuard = (
  vars: CustomerContextVars,
  routes: ReturnType<typeof buildWebChatRoutes>,
) => {
  const app = new Hono<{ Variables: CustomerContextVars }>();
  app.use("*", async (c, next) => {
    c.set("session", vars.session);
    c.set("orgId", vars.orgId);
    c.set("role", vars.role);
    await next();
  });
  app.route("/", routes);
  return app;
};

const buildPrismaMock = () => {
  const connectorInstance = {
    capabilities: { inbound: true, outbound: true },
    config: {},
    createdAt: new Date("2026-01-01"),
    displayName: "Chat do cliente",
    id: "ci_web_a",
    orgId: "org_a",
    senderRole: "CUSTOMER" as const,
    type: "WEB_CHAT" as const,
    updatedAt: new Date("2026-01-01"),
  };

  const conversation = {
    channel: "WEB_CHAT" as const,
    connectorInstanceId: connectorInstance.id,
    createdAt: new Date("2026-01-02"),
    externalId: "web-1",
    id: "conv_1",
    orgId: "org_a",
    status: "ACTIVE" as const,
    updatedAt: new Date("2026-01-02T12:00:00.000Z"),
  };

  return {
    connectorInstance,
    conversation,
    prisma: {
      agentConnectorBinding: {
        upsert: vi.fn().mockResolvedValue({ id: "binding_1" }),
      },
      agentInstance: {
        upsert: vi.fn().mockResolvedValue({ id: "ag_1", orgId: "org_a", templateSlug: "controller" }),
      },
      brandAsset: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      connectorInstance: {
        create: vi.fn().mockResolvedValue(connectorInstance),
        findFirst: vi.fn().mockResolvedValue(connectorInstance),
      },
      conversation: {
        create: vi.fn().mockResolvedValue(conversation),
        findFirst: vi.fn(
          ({ where }: { where: { id?: string; orgId: string } }) => {
            const idMatches = !where.id || where.id === conversation.id;
            if (idMatches && where.orgId === conversation.orgId) {
              return Promise.resolve(conversation);
            }
            return Promise.resolve(null);
          },
        ),
        findMany: vi.fn().mockResolvedValue([
          {
            ...conversation,
            messages: [{ content: "última mensagem", createdAt: new Date(), sender: "AGENT" }],
          },
        ]),
      },
      message: {
        findMany: vi.fn().mockResolvedValue([
          {
            content: "oi",
            contentType: "TEXT",
            createdAt: new Date("2026-01-02T12:00:00.000Z"),
            id: "msg_1",
            metadata: {},
            sender: "CUSTOMER",
          },
        ]),
      },
    },
  };
};

describe("GET /web-chat/conversations", () => {
  it("returns the customer's conversations for their org", async () => {
    const { prisma } = buildPrismaMock();
    const routes = buildWebChatRoutes({ prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/conversations"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: ReadonlyArray<{ id: string; lastMessagePreview: string | null }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe("conv_1");
    expect(body.items[0]!.lastMessagePreview).toBe("última mensagem");
  });

  it("returns an empty list when the org has no WEB_CHAT connector yet", async () => {
    const { prisma } = buildPrismaMock();
    prisma.connectorInstance.findFirst.mockResolvedValueOnce(null);
    const routes = buildWebChatRoutes({ prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/conversations"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: ReadonlyArray<unknown> };
    expect(body.items).toHaveLength(0);
  });
});

describe("GET /web-chat/messages", () => {
  it("returns paginated messages for an owned conversation", async () => {
    const { prisma } = buildPrismaMock();
    const routes = buildWebChatRoutes({ prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/messages?conversationId=conv_1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: ReadonlyArray<{ id: string; sender: string }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.sender).toBe("CUSTOMER");
  });

  it("rejects without conversationId", async () => {
    const { prisma } = buildPrismaMock();
    const routes = buildWebChatRoutes({ prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/messages"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for cross-org conversation lookups", async () => {
    const { prisma } = buildPrismaMock();
    const routes = buildWebChatRoutes({ prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_other", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/messages?conversationId=conv_1"));
    expect(res.status).toBe(404);
  });
});

describe("POST /web-chat/messages", () => {
  it("creates a Conversation when none exists and dispatches to the pipeline", async () => {
    const { conversation, prisma } = buildPrismaMock();
    const handleInbound = vi.fn().mockResolvedValue(undefined);
    const routes = buildWebChatRoutes({ handleInbound, prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/messages", {
        body: JSON.stringify({ text: "oi" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversationId: string; messageExternalId: string };
    expect(body.conversationId).toBe(conversation.id);
    expect(typeof body.messageExternalId).toBe("string");
    expect(prisma.conversation.create).toHaveBeenCalledOnce();
    expect(handleInbound).toHaveBeenCalledOnce();
  });

  it("reuses an existing conversation when conversationId is supplied", async () => {
    const { conversation, prisma } = buildPrismaMock();
    const handleInbound = vi.fn().mockResolvedValue(undefined);
    const routes = buildWebChatRoutes({ handleInbound, prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/messages", {
        body: JSON.stringify({ conversationId: conversation.id, text: "oi de novo" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(handleInbound).toHaveBeenCalledOnce();
  });

  it("rejects payloads with neither text nor attachments", async () => {
    const { prisma } = buildPrismaMock();
    const handleInbound = vi.fn();
    const routes = buildWebChatRoutes({ handleInbound, prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/messages", {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(res.status).toBe(400);
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it("returns 404 when conversationId belongs to a different org", async () => {
    const { prisma } = buildPrismaMock();
    const handleInbound = vi.fn();
    prisma.conversation.findFirst.mockResolvedValueOnce(null);
    const routes = buildWebChatRoutes({ handleInbound, prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/messages", {
        body: JSON.stringify({ conversationId: "conv_other", text: "oi" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(res.status).toBe(404);
    expect(handleInbound).not.toHaveBeenCalled();
  });
});

describe("GET /web-chat/stream", () => {
  it("subscribes to the bus and emits the ready event", async () => {
    const { prisma } = buildPrismaMock();
    const subscribers = new Set<(event: unknown) => void>();
    const bus = {
      publish: vi.fn(),
      subscribe: vi.fn((_id: string, handler: (event: unknown) => void) => {
        subscribers.add(handler);
        return () => {
          subscribers.delete(handler);
        };
      }),
      subscriberCount: vi.fn(),
    };

    const routes = buildWebChatRoutes({ bus: bus as never, prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/stream?conversationId=conv_1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // Pull one frame from the SSE body and verify the ready handshake.
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("event: ready");
    await reader.cancel();
    expect(bus.subscribe).toHaveBeenCalled();
  });

  it("rejects without conversationId", async () => {
    const { prisma } = buildPrismaMock();
    const routes = buildWebChatRoutes({ prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/stream"));
    expect(res.status).toBe(400);
  });
});

describe("GET /web-chat/assets", () => {
  it("returns the org's brand assets", async () => {
    const { prisma } = buildPrismaMock();
    prisma.brandAsset.findMany.mockResolvedValueOnce([
      {
        createdAt: new Date(),
        id: "ba_1",
        metadata: { palette: ["#000"] },
        mimeType: "image/png",
        r2Key: "k/1",
        size: 1024,
      },
    ]);
    const routes = buildWebChatRoutes({ prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/assets"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: ReadonlyArray<{ id: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe("ba_1");
  });
});

describe("GET /web-chat/assets/:id", () => {
  it("streams bytes from R2 for an owned asset", async () => {
    const { prisma } = buildPrismaMock();
    prisma.brandAsset.findFirst.mockResolvedValueOnce({
      id: "ba_1",
      mimeType: "image/png",
      orgId: "org_a",
      r2Key: "key/abc",
    });
    const fetchAsset = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const routes = buildWebChatRoutes({ fetchAsset, prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/assets/ba_1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(fetchAsset).toHaveBeenCalledWith("key/abc");
  });

  it("returns 404 when the asset belongs to a different org", async () => {
    const { prisma } = buildPrismaMock();
    prisma.brandAsset.findFirst.mockResolvedValueOnce(null);
    const fetchAsset = vi.fn();
    const routes = buildWebChatRoutes({ fetchAsset, prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "CUSTOMER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/assets/ba_other"));
    expect(res.status).toBe(404);
    expect(fetchAsset).not.toHaveBeenCalled();
  });
});
