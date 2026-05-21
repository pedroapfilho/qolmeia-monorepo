import { describe, expect, it, vi } from "vitest";

import {
  handleOwnerCommand,
  NO_ROUTINES_REPLY,
  parseOwnerCommand,
  ROUTINE_REQUIRES_NAME_REPLY,
  RUN_REQUIRES_NAME_REPLY,
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

  it("parses /rotinas as list-routines", () => {
    expect(parseOwnerCommand("/rotinas")).toEqual({ kind: "list-routines" });
    expect(parseOwnerCommand("  /rotinas  ")).toEqual({ kind: "list-routines" });
    expect(parseOwnerCommand("/ROTINAS@qolmeiabot")).toEqual({ kind: "list-routines" });
  });

  it("parses /ligar <name> as toggle-routine enable=true", () => {
    expect(parseOwnerCommand("/ligar nightly-knowledge-summary")).toEqual({
      enable: true,
      kind: "toggle-routine",
      name: "nightly-knowledge-summary",
    });
  });

  it("parses /desligar <name> as toggle-routine enable=false", () => {
    expect(parseOwnerCommand("/desligar nightly-knowledge-summary")).toEqual({
      enable: false,
      kind: "toggle-routine",
      name: "nightly-knowledge-summary",
    });
  });

  it("parses /correr <name> as run-routine", () => {
    expect(parseOwnerCommand("/correr nightly-knowledge-summary")).toEqual({
      kind: "run-routine",
      name: "nightly-knowledge-summary",
    });
  });

  it("parses bare /ligar /desligar /correr with empty name (handler rejects)", () => {
    expect(parseOwnerCommand("/ligar")).toEqual({
      enable: true,
      kind: "toggle-routine",
      name: "",
    });
    expect(parseOwnerCommand("/desligar")).toEqual({
      enable: false,
      kind: "toggle-routine",
      name: "",
    });
    expect(parseOwnerCommand("/correr")).toEqual({ kind: "run-routine", name: "" });
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

const makeRoutinePrisma = (
  rows: ReadonlyArray<{
    enabled: boolean;
    id?: string;
    lastRunAt?: Date | null;
    lastRunStatus?: string | null;
    name: string;
    schedule: string;
  }>,
) => {
  const findMany = vi.fn().mockResolvedValue(
    rows.map((r) => ({
      enabled: r.enabled,
      lastRunAt: r.lastRunAt ?? null,
      lastRunStatus: r.lastRunStatus ?? null,
      name: r.name,
      schedule: r.schedule,
    })),
  );
  const findUnique = vi.fn().mockImplementation(({ where }: { where: unknown }) => {
    const w = where as { id?: string; orgId_name?: { name: string; orgId: string } };
    const row = rows.find((r) => {
      if (w.id && r.id === w.id) {
        return true;
      }
      if (w.orgId_name && r.name === w.orgId_name.name) {
        return true;
      }
      return false;
    });
    if (!row) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ enabled: row.enabled, id: row.id ?? `rt_${row.name}` });
  });
  const update = vi.fn().mockResolvedValue({});
  const activityCreate = vi.fn().mockResolvedValue({ id: "al_routine" });
  return {
    activityLog: { create: activityCreate },
    mocks: { activityCreate, findMany, findUnique, update },
    organization: { findUnique: vi.fn(), update: vi.fn() },
    routine: { findMany, findUnique, update },
  };
};

describe("handleOwnerCommand routine commands", () => {
  it("list-routines returns the empty-state reply when no rows", async () => {
    const prisma = makeRoutinePrisma([]);
    const reply = await handleOwnerCommand({
      command: { kind: "list-routines" },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toBe(NO_ROUTINES_REPLY);
  });

  it("list-routines renders one line per row with name, state, schedule, last run", async () => {
    const prisma = makeRoutinePrisma([
      {
        enabled: true,
        lastRunAt: new Date("2026-05-20T03:00:00Z"),
        lastRunStatus: "SUCCEEDED",
        name: "nightly-knowledge-summary",
        schedule: "0 3 * * *",
      },
      {
        enabled: false,
        name: "weekly-report",
        schedule: "0 9 * * 1",
      },
    ]);
    const reply = await handleOwnerCommand({
      command: { kind: "list-routines" },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toContain("nightly-knowledge-summary");
    expect(reply).toContain("ligada");
    expect(reply).toContain("`0 3 * * *`");
    expect(reply).toContain("ok em 2026-05-20T03:00:00.000Z");
    expect(reply).toContain("weekly-report");
    expect(reply).toContain("desligada");
    expect(reply).toContain("nunca rodou");
  });

  it("toggle-routine rejects empty names", async () => {
    const prisma = makeRoutinePrisma([]);
    const triggerReconcile = vi.fn();
    const reply = await handleOwnerCommand({
      command: { enable: true, kind: "toggle-routine", name: "" },
      deps: { triggerReconcile },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toBe(ROUTINE_REQUIRES_NAME_REPLY);
    expect(triggerReconcile).not.toHaveBeenCalled();
  });

  it("toggle-routine returns a not-found reply when the row doesn't exist", async () => {
    const prisma = makeRoutinePrisma([]);
    const triggerReconcile = vi.fn();
    const reply = await handleOwnerCommand({
      command: { enable: true, kind: "toggle-routine", name: "nightly-knowledge-summary" },
      deps: { triggerReconcile },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toContain("não encontrada");
    expect(triggerReconcile).not.toHaveBeenCalled();
  });

  it("toggle-routine /ligar flips enabled, emits ROUTINE_ENABLED, and reconciles", async () => {
    const prisma = makeRoutinePrisma([
      {
        enabled: false,
        id: "rt_1",
        name: "nightly-knowledge-summary",
        schedule: "0 3 * * *",
      },
    ]);
    const triggerReconcile = vi.fn().mockResolvedValue(undefined);
    const reply = await handleOwnerCommand({
      command: { enable: true, kind: "toggle-routine", name: "nightly-knowledge-summary" },
      deps: { triggerReconcile },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toBe('Rotina "nightly-knowledge-summary" ligada.');
    expect(prisma.mocks.update).toHaveBeenCalledWith({
      data: { enabled: true },
      where: { id: "rt_1" },
    });
    const activityCall = prisma.mocks.activityCreate.mock.calls[0]![0] as {
      data: { refType: string; type: string };
    };
    expect(activityCall.data.type).toBe("ROUTINE_ENABLED");
    expect(activityCall.data.refType).toBe("ROUTINE");
    expect(triggerReconcile).toHaveBeenCalledOnce();
  });

  it("toggle-routine /desligar flips enabled, emits ROUTINE_DISABLED, and reconciles", async () => {
    const prisma = makeRoutinePrisma([
      {
        enabled: true,
        id: "rt_1",
        name: "nightly-knowledge-summary",
        schedule: "0 3 * * *",
      },
    ]);
    const triggerReconcile = vi.fn().mockResolvedValue(undefined);
    await handleOwnerCommand({
      command: { enable: false, kind: "toggle-routine", name: "nightly-knowledge-summary" },
      deps: { triggerReconcile },
      orgId: "org_1",
      prisma: prisma as never,
    });
    const activityCall = prisma.mocks.activityCreate.mock.calls[0]![0] as {
      data: { type: string };
    };
    expect(activityCall.data.type).toBe("ROUTINE_DISABLED");
    expect(triggerReconcile).toHaveBeenCalledOnce();
  });

  it("toggle-routine short-circuits when the desired state already holds (no activity, no reconcile)", async () => {
    const prisma = makeRoutinePrisma([
      {
        enabled: true,
        id: "rt_1",
        name: "nightly-knowledge-summary",
        schedule: "0 3 * * *",
      },
    ]);
    const triggerReconcile = vi.fn();
    const reply = await handleOwnerCommand({
      command: { enable: true, kind: "toggle-routine", name: "nightly-knowledge-summary" },
      deps: { triggerReconcile },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toContain("já está ligada");
    expect(prisma.mocks.activityCreate).not.toHaveBeenCalled();
    expect(triggerReconcile).not.toHaveBeenCalled();
  });

  it("run-routine rejects empty names and unknown definitions", async () => {
    const prisma = makeRoutinePrisma([]);
    const executeRoutine = vi.fn();
    const emptyReply = await handleOwnerCommand({
      command: { kind: "run-routine", name: "" },
      deps: { executeRoutine },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(emptyReply).toBe(RUN_REQUIRES_NAME_REPLY);
    expect(executeRoutine).not.toHaveBeenCalled();

    const unknownReply = await handleOwnerCommand({
      command: { kind: "run-routine", name: "fictitious-routine" },
      deps: { executeRoutine },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(unknownReply).toContain("não tem definição registrada");
    expect(executeRoutine).not.toHaveBeenCalled();
  });

  it("run-routine returns not-cadastrada when the org has no Routine row", async () => {
    const prisma = makeRoutinePrisma([]);
    const executeRoutine = vi.fn();
    const reply = await handleOwnerCommand({
      command: { kind: "run-routine", name: "nightly-knowledge-summary" },
      deps: { executeRoutine },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toContain("não está cadastrada");
    expect(executeRoutine).not.toHaveBeenCalled();
  });

  it("run-routine calls executeRoutine with the row id and reports SUCCEEDED", async () => {
    const prisma = makeRoutinePrisma([
      {
        enabled: true,
        id: "rt_1",
        name: "nightly-knowledge-summary",
        schedule: "0 3 * * *",
      },
    ]);
    const executeRoutine = vi
      .fn()
      .mockResolvedValue({ agentRunId: "run_1", status: "SUCCEEDED" as const });
    const dispatcher = { enqueueAndAwait: vi.fn() };
    const reply = await handleOwnerCommand({
      command: { kind: "run-routine", name: "nightly-knowledge-summary" },
      deps: { dispatcher, executeRoutine },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toBe('Rotina "nightly-knowledge-summary" executada.');
    expect(executeRoutine).toHaveBeenCalledOnce();
    const call = executeRoutine.mock.calls[0]![0] as { routineId: string };
    expect(call.routineId).toBe("rt_1");
  });

  it("run-routine reports a failure reply when the executor returns FAILED", async () => {
    const prisma = makeRoutinePrisma([
      {
        enabled: true,
        id: "rt_1",
        name: "nightly-knowledge-summary",
        schedule: "0 3 * * *",
      },
    ]);
    const executeRoutine = vi
      .fn()
      .mockResolvedValue({ agentRunId: null, status: "FAILED" as const });
    const reply = await handleOwnerCommand({
      command: { kind: "run-routine", name: "nightly-knowledge-summary" },
      deps: { dispatcher: { enqueueAndAwait: vi.fn() }, executeRoutine },
      orgId: "org_1",
      prisma: prisma as never,
    });
    expect(reply).toContain("falhou");
  });

  it("run-routine temporarily flips enabled=true so a paused routine can be triggered manually", async () => {
    const prisma = makeRoutinePrisma([
      {
        enabled: false,
        id: "rt_1",
        name: "nightly-knowledge-summary",
        schedule: "0 3 * * *",
      },
    ]);
    const executeRoutine = vi
      .fn()
      .mockResolvedValue({ agentRunId: "run_1", status: "SUCCEEDED" as const });
    await handleOwnerCommand({
      command: { kind: "run-routine", name: "nightly-knowledge-summary" },
      deps: { dispatcher: { enqueueAndAwait: vi.fn() }, executeRoutine },
      orgId: "org_1",
      prisma: prisma as never,
    });
    // First update: enable. Second update: restore to disabled.
    expect(prisma.mocks.update).toHaveBeenCalledTimes(2);
    expect(prisma.mocks.update.mock.calls[0]![0]).toEqual({
      data: { enabled: true },
      where: { id: "rt_1" },
    });
    expect(prisma.mocks.update.mock.calls[1]![0]).toEqual({
      data: { enabled: false },
      where: { id: "rt_1" },
    });
  });
});
