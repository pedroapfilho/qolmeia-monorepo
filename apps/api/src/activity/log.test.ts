import { describe, expect, it, vi } from "vitest";

import { logActivity } from "./log";

describe("logActivity", () => {
  it("creates an ActivityLog row with defaults for optional fields", async () => {
    const create = vi.fn().mockResolvedValue({ id: "act_1" });
    const prisma = { activityLog: { create } } as never;

    await logActivity({
      orgId: "org_1",
      prisma,
      refType: "NONE",
      summary: "evento de teste",
      type: "OWNER_COMMAND",
    });

    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0]![0] as {
      data: {
        actorId: string | null;
        orgId: string;
        payload: object | undefined;
        refId: string | null;
        refType: string;
        summary: string;
        type: string;
      };
    };
    expect(arg.data.orgId).toBe("org_1");
    expect(arg.data.type).toBe("OWNER_COMMAND");
    expect(arg.data.refType).toBe("NONE");
    expect(arg.data.summary).toBe("evento de teste");
    expect(arg.data.refId).toBeNull();
    expect(arg.data.actorId).toBeNull();
    expect(arg.data.payload).toBeUndefined();
  });

  it("threads refId, payload, and actorId when supplied", async () => {
    const create = vi.fn().mockResolvedValue({ id: "act_2" });
    const prisma = { activityLog: { create } } as never;

    await logActivity({
      actorId: "user_1",
      orgId: "org_1",
      payload: { foo: "bar" },
      prisma,
      refId: "msg_1",
      refType: "MESSAGE",
      summary: "mensagem recebida",
      type: "MESSAGE_INBOUND",
    });

    const arg = create.mock.calls[0]![0] as {
      data: { actorId: string | null; payload: object; refId: string | null };
    };
    expect(arg.data.refId).toBe("msg_1");
    expect(arg.data.actorId).toBe("user_1");
    expect(arg.data.payload).toEqual({ foo: "bar" });
  });

  it("swallows write errors so callers never throw because of logging", async () => {
    const create = vi.fn().mockRejectedValue(new Error("db down"));
    const prisma = { activityLog: { create } } as never;

    // Should not throw even though the underlying create rejected.
    await expect(
      logActivity({
        orgId: "org_1",
        prisma,
        refType: "NONE",
        summary: "x",
        type: "OWNER_COMMAND",
      }),
    ).resolves.toBeUndefined();
  });
});
