import { describe, expect, it, vi } from "vitest";

import {
  handleOwnerCommand,
  parseOwnerCommand,
  UNSET_IDEA_REPLY,
  UNSET_INSTRUCTIONS_REPLY,
  UPDATED_IDEA_REPLY,
  UPDATED_INSTRUCTIONS_REPLY,
} from "./owner-commands";

describe("parseOwnerCommand", () => {
  it("returns null for non-strings, empty strings, and non-slash messages", () => {
    expect(parseOwnerCommand(null)).toBeNull();
    expect(parseOwnerCommand(undefined)).toBeNull();
    expect(parseOwnerCommand("")).toBeNull();
    expect(parseOwnerCommand("oi tudo bem")).toBeNull();
    expect(parseOwnerCommand("/")).toBeNull();
    expect(parseOwnerCommand("/algumacoisa")).toBeNull();
  });

  it("parses bare /instrucoes as get-instructions", () => {
    expect(parseOwnerCommand("/instrucoes")).toEqual({ kind: "get-instructions" });
    expect(parseOwnerCommand("  /instrucoes  ")).toEqual({ kind: "get-instructions" });
  });

  it("parses /instrucoes <text> as set-instructions and preserves multi-word value", () => {
    expect(parseOwnerCommand("/instrucoes responda em pt-BR sempre")).toEqual({
      kind: "set-instructions",
      value: "responda em pt-BR sempre",
    });
  });

  it("parses bare /ideia as get-idea", () => {
    expect(parseOwnerCommand("/ideia")).toEqual({ kind: "get-idea" });
  });

  it("parses /ideia <text> as set-idea", () => {
    expect(parseOwnerCommand("/ideia salão premium em SP")).toEqual({
      kind: "set-idea",
      value: "salão premium em SP",
    });
  });

  it("strips @botname suffix from the command head", () => {
    expect(parseOwnerCommand("/instrucoes@qolmeiabot foo bar")).toEqual({
      kind: "set-instructions",
      value: "foo bar",
    });
    expect(parseOwnerCommand("/ideia@qolmeiabot")).toEqual({ kind: "get-idea" });
  });

  it("is case-insensitive on the command head but preserves value casing", () => {
    expect(parseOwnerCommand("/INSTRUCOES Tom Formal")).toEqual({
      kind: "set-instructions",
      value: "Tom Formal",
    });
  });
});

const makePrisma = (existing: {
  agentInstructions?: string | null;
  businessIdea?: string | null;
}) => {
  const findUnique = vi
    .fn()
    .mockImplementation(({ select }: { select: Record<string, boolean> }) => {
      if (select.agentInstructions) {
        return Promise.resolve({ agentInstructions: existing.agentInstructions ?? null });
      }
      if (select.businessIdea) {
        return Promise.resolve({ businessIdea: existing.businessIdea ?? null });
      }
      return Promise.resolve(null);
    });
  const update = vi.fn().mockResolvedValue({});
  const activityCreate = vi.fn().mockResolvedValue({ id: "al_1" });
  return {
    activityLog: { create: activityCreate },
    mocks: { activityCreate, findUnique, update },
    organization: { findUnique, update },
  };
};

describe("handleOwnerCommand", () => {
  it("get-instructions returns the unset reply when null/empty", async () => {
    const prisma = makePrisma({ agentInstructions: null });
    const reply = await handleOwnerCommand({
      command: { kind: "get-instructions" },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toBe(UNSET_INSTRUCTIONS_REPLY);
  });

  it("get-instructions returns the current value when set", async () => {
    const prisma = makePrisma({ agentInstructions: "Sempre em pt-BR." });
    const reply = await handleOwnerCommand({
      command: { kind: "get-instructions" },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toBe("Sempre em pt-BR.");
  });

  it("set-instructions writes the value and replies with the confirmation", async () => {
    const prisma = makePrisma({});
    const reply = await handleOwnerCommand({
      command: { kind: "set-instructions", value: "Tom descontraído." },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toBe(UPDATED_INSTRUCTIONS_REPLY);
    expect(prisma.mocks.update).toHaveBeenCalledWith({
      data: { agentInstructions: "Tom descontraído." },
      where: { id: "org_1" },
    });
  });

  it("get-idea returns the unset reply when null", async () => {
    const prisma = makePrisma({ businessIdea: null });
    const reply = await handleOwnerCommand({
      command: { kind: "get-idea" },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toBe(UNSET_IDEA_REPLY);
  });

  it("get-idea returns the current value when set", async () => {
    const prisma = makePrisma({ businessIdea: "Salão em SP." });
    const reply = await handleOwnerCommand({
      command: { kind: "get-idea" },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toBe("Salão em SP.");
  });

  it("set-idea writes the value and replies with the confirmation", async () => {
    const prisma = makePrisma({});
    const reply = await handleOwnerCommand({
      command: { kind: "set-idea", value: "Salão em SP." },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toBe(UPDATED_IDEA_REPLY);
    expect(prisma.mocks.update).toHaveBeenCalledWith({
      data: { businessIdea: "Salão em SP." },
      where: { id: "org_1" },
    });
  });

  it("set-instructions emits an INSTRUCTIONS_UPDATED ActivityLog row", async () => {
    const prisma = makePrisma({});
    await handleOwnerCommand({
      command: { kind: "set-instructions", value: "Sempre responda em pt-BR." },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(prisma.mocks.activityCreate).toHaveBeenCalledOnce();
    const arg = prisma.mocks.activityCreate.mock.calls[0]![0] as {
      data: { orgId: string; refType: string; type: string };
    };
    expect(arg.data.type).toBe("INSTRUCTIONS_UPDATED");
    expect(arg.data.refType).toBe("ORGANIZATION");
    expect(arg.data.orgId).toBe("org_1");
  });

  it("set-idea emits a BUSINESS_IDEA_UPDATED ActivityLog row", async () => {
    const prisma = makePrisma({});
    await handleOwnerCommand({
      command: { kind: "set-idea", value: "Salão em SP." },
      orgId: "org_1",
      prisma: prisma as never,
    });
    const arg = prisma.mocks.activityCreate.mock.calls[0]![0] as {
      data: { refType: string; type: string };
    };
    expect(arg.data.type).toBe("BUSINESS_IDEA_UPDATED");
    expect(arg.data.refType).toBe("ORGANIZATION");
  });

  it("get-* commands do NOT emit ActivityLog (read-only)", async () => {
    const prisma = makePrisma({ agentInstructions: "x", businessIdea: "y" });
    await handleOwnerCommand({
      command: { kind: "get-instructions" },
      orgId: "org_1",
      prisma: prisma as never,
    });
    await handleOwnerCommand({
      command: { kind: "get-idea" },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(prisma.mocks.activityCreate).not.toHaveBeenCalled();
  });
});
