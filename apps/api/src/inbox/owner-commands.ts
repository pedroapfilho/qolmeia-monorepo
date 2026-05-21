import type { PrismaClient } from "@repo/db";

import { logActivity } from "../activity/log";
import type { AgentDispatcher } from "../agents/dispatcher";
import { dispatcher as defaultDispatcher } from "../agents/main-dispatcher";
import { logger } from "../lib/logger";
import { executeRoutine as defaultExecuteRoutine } from "../routines/executor";
import { findRoutineByName } from "../routines/registry";
import { triggerReconcile as defaultTriggerReconcile } from "../routines/scheduler-control";

type OwnerCommand =
  | { kind: "get-idea" }
  | { kind: "get-instructions" }
  | { kind: "list-routines" }
  | { kind: "run-routine"; name: string }
  | { kind: "set-idea"; value: string }
  | { kind: "set-instructions"; value: string }
  | { enable: boolean; kind: "toggle-routine"; name: string };

const UNSET_INSTRUCTIONS_REPLY = "Ainda não definidas. Use `/instrucoes <texto>` para configurar.";
const UNSET_IDEA_REPLY = "Ainda não definida. Use `/ideia <texto>` para configurar.";
const UPDATED_INSTRUCTIONS_REPLY = "Instruções atualizadas.";
const UPDATED_IDEA_REPLY = "Ideia do negócio atualizada.";
const NO_ROUTINES_REPLY =
  "Nenhuma rotina cadastrada ainda. Rode `pnpm tsx apps/api/src/scripts/sync-routines.ts` para semear.";
const ROUTINE_REQUIRES_NAME_REPLY =
  "Use `/ligar <nome>` ou `/desligar <nome>`. Veja os nomes com `/rotinas`.";
const RUN_REQUIRES_NAME_REPLY = "Use `/correr <nome>`. Veja os nomes com `/rotinas`.";

const formatRunStatus = (status: string | null, when: Date | null): string => {
  if (!status || !when) {
    return "nunca rodou";
  }
  const label = status === "SUCCEEDED" ? "ok" : "falhou";
  return `${label} em ${when.toISOString()}`;
};

/**
 * Parses owner-only Telegram slash commands. Returns null when the text isn't
 * a recognised command (so the pipeline forwards it to the agent runtime).
 *
 * - `/instrucoes` (alone) — read current Organization.agentInstructions
 * - `/instrucoes <text>` — set Organization.agentInstructions to <text>
 * - `/ideia` (alone) — read current Organization.businessIdea
 * - `/ideia <text>` — set Organization.businessIdea to <text>
 * - `/rotinas` — list routines + their current state (schedule/enabled/lastRun)
 * - `/ligar <name>` — flip Routine.enabled = true + reconcile BullMQ scheduler
 * - `/desligar <name>` — flip Routine.enabled = false + reconcile
 * - `/correr <name>` — run a routine NOW (one-off; doesn't change schedule)
 */
const parseOwnerCommand = (text: string | null | undefined): OwnerCommand | null => {
  if (typeof text !== "string") {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  // Split into command head + rest. The head may include "@botname" suffix
  // when sent via group chats; strip it before matching.
  const firstSpace = trimmed.search(/\s/v);
  const rawHead = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();
  const atIdx = rawHead.indexOf("@");
  const head = (atIdx === -1 ? rawHead : rawHead.slice(0, atIdx)).toLowerCase();

  if (head === "/instrucoes") {
    return rest.length === 0
      ? { kind: "get-instructions" }
      : { kind: "set-instructions", value: rest };
  }
  if (head === "/ideia") {
    return rest.length === 0 ? { kind: "get-idea" } : { kind: "set-idea", value: rest };
  }
  if (head === "/rotinas") {
    return { kind: "list-routines" };
  }
  if (head === "/ligar") {
    return { enable: true, kind: "toggle-routine", name: rest };
  }
  if (head === "/desligar") {
    return { enable: false, kind: "toggle-routine", name: rest };
  }
  if (head === "/correr") {
    return { kind: "run-routine", name: rest };
  }
  return null;
};

type OwnerCommandPrisma = Pick<
  PrismaClient,
  "activityLog" | "agentInstance" | "agentRun" | "knowledgeDoc" | "organization" | "routine"
>;

type OwnerCommandDeps = {
  dispatcher?: AgentDispatcher;
  executeRoutine?: typeof defaultExecuteRoutine;
  triggerReconcile?: typeof defaultTriggerReconcile;
};

const handleListRoutines = async (orgId: string, prisma: OwnerCommandPrisma): Promise<string> => {
  const rows = await prisma.routine.findMany({
    orderBy: { name: "asc" },
    select: {
      enabled: true,
      lastRunAt: true,
      lastRunStatus: true,
      name: true,
      schedule: true,
    },
    where: { orgId },
  });
  if (rows.length === 0) {
    return NO_ROUTINES_REPLY;
  }
  const lines = rows.map((r) => {
    const state = r.enabled ? "ligada" : "desligada";
    const lastRun = formatRunStatus(r.lastRunStatus, r.lastRunAt);
    return `- ${r.name} — ${state} (cron: \`${r.schedule}\`, última: ${lastRun})`;
  });
  return ["Rotinas:", ...lines].join("\n");
};

const handleToggleRoutine = async ({
  enable,
  name,
  orgId,
  prisma,
  triggerReconcile,
}: {
  enable: boolean;
  name: string;
  orgId: string;
  prisma: OwnerCommandPrisma;
  triggerReconcile: typeof defaultTriggerReconcile;
}): Promise<string> => {
  if (name.length === 0) {
    return ROUTINE_REQUIRES_NAME_REPLY;
  }
  const existing = await prisma.routine.findUnique({
    select: { enabled: true, id: true },
    where: { orgId_name: { name, orgId } },
  });
  if (!existing) {
    return `Rotina "${name}" não encontrada. Veja \`/rotinas\`.`;
  }
  if (existing.enabled === enable) {
    return enable ? `Rotina "${name}" já está ligada.` : `Rotina "${name}" já está desligada.`;
  }
  await prisma.routine.update({
    data: { enabled: enable },
    where: { id: existing.id },
  });
  await logActivity({
    orgId,
    payload: { name, routineId: existing.id },
    prisma,
    refId: existing.id,
    refType: "ROUTINE",
    summary: enable ? `Dono ligou a rotina "${name}"` : `Dono desligou a rotina "${name}"`,
    type: enable ? "ROUTINE_ENABLED" : "ROUTINE_DISABLED",
  });
  // Reconcile is best-effort — the scheduler also reconciles on boot, so a
  // transient Redis failure here just delays the schedule change until the
  // next worker restart.
  try {
    await triggerReconcile();
  } catch (error) {
    logger.error({ error, name, orgId }, "owner-command.reconcile_failed");
  }
  return enable ? `Rotina "${name}" ligada.` : `Rotina "${name}" desligada.`;
};

const handleRunRoutine = async ({
  dispatcher,
  executeRoutine,
  name,
  orgId,
  prisma,
}: {
  dispatcher: AgentDispatcher;
  executeRoutine: typeof defaultExecuteRoutine;
  name: string;
  orgId: string;
  prisma: OwnerCommandPrisma;
}): Promise<string> => {
  if (name.length === 0) {
    return RUN_REQUIRES_NAME_REPLY;
  }
  if (!findRoutineByName(name)) {
    return `Rotina "${name}" não tem definição registrada.`;
  }
  const row = await prisma.routine.findUnique({
    select: { id: true },
    where: { orgId_name: { name, orgId } },
  });
  if (!row) {
    return `Rotina "${name}" não está cadastrada para este negócio. Veja \`/rotinas\`.`;
  }
  // Direct invocation — `/correr` is a manual one-off that bypasses cron and
  // the enabled flag, so we don't go through BullMQ. The executor still
  // records ROUTINE_TRIGGERED and updates lastRunAt/lastRunStatus.
  // Defensive: executor swallows its own errors so a failure becomes a
  // lastRunStatus=FAILED row instead of a thrown reply to the owner.
  // We re-check enabled inside the executor; for /correr the owner intent is
  // "run now regardless of schedule," so we temporarily flip enabled if
  // needed and restore.
  const wasDisabled = await prisma.routine.findUnique({
    select: { enabled: true },
    where: { id: row.id },
  });
  if (wasDisabled && !wasDisabled.enabled) {
    await prisma.routine.update({ data: { enabled: true }, where: { id: row.id } });
  }
  const outcome = await executeRoutine({ dispatcher, prisma, routineId: row.id });
  if (wasDisabled && !wasDisabled.enabled) {
    await prisma.routine.update({ data: { enabled: false }, where: { id: row.id } });
  }
  return outcome.status === "SUCCEEDED"
    ? `Rotina "${name}" executada.`
    : `Rotina "${name}" falhou — veja os logs.`;
};

const handleOwnerCommand = async ({
  command,
  deps,
  orgId,
  prisma,
}: {
  command: OwnerCommand;
  deps?: OwnerCommandDeps;
  orgId: string;
  prisma: OwnerCommandPrisma;
}): Promise<string> => {
  const dispatcher = deps?.dispatcher ?? defaultDispatcher;
  const executeRoutine = deps?.executeRoutine ?? defaultExecuteRoutine;
  const triggerReconcile = deps?.triggerReconcile ?? defaultTriggerReconcile;

  if (command.kind === "get-instructions") {
    const row = await prisma.organization.findUnique({
      select: { agentInstructions: true },
      where: { id: orgId },
    });
    const value = row?.agentInstructions ?? null;
    return value === null || value.length === 0 ? UNSET_INSTRUCTIONS_REPLY : value;
  }
  if (command.kind === "set-instructions") {
    await prisma.organization.update({
      data: { agentInstructions: command.value },
      where: { id: orgId },
    });
    await logActivity({
      orgId,
      payload: { length: command.value.length },
      prisma,
      refId: orgId,
      refType: "ORGANIZATION",
      summary: "Dono atualizou as instruções dos agentes",
      type: "INSTRUCTIONS_UPDATED",
    });
    return UPDATED_INSTRUCTIONS_REPLY;
  }
  if (command.kind === "get-idea") {
    const row = await prisma.organization.findUnique({
      select: { businessIdea: true },
      where: { id: orgId },
    });
    const value = row?.businessIdea ?? null;
    return value === null || value.length === 0 ? UNSET_IDEA_REPLY : value;
  }
  if (command.kind === "set-idea") {
    await prisma.organization.update({
      data: { businessIdea: command.value },
      where: { id: orgId },
    });
    await logActivity({
      orgId,
      payload: { length: command.value.length },
      prisma,
      refId: orgId,
      refType: "ORGANIZATION",
      summary: "Dono atualizou a ideia do negócio",
      type: "BUSINESS_IDEA_UPDATED",
    });
    return UPDATED_IDEA_REPLY;
  }
  if (command.kind === "list-routines") {
    return handleListRoutines(orgId, prisma);
  }
  if (command.kind === "toggle-routine") {
    return handleToggleRoutine({
      enable: command.enable,
      name: command.name,
      orgId,
      prisma,
      triggerReconcile,
    });
  }
  // command.kind === "run-routine"
  return handleRunRoutine({
    dispatcher,
    executeRoutine,
    name: command.name,
    orgId,
    prisma,
  });
};

export {
  handleOwnerCommand,
  NO_ROUTINES_REPLY,
  parseOwnerCommand,
  ROUTINE_REQUIRES_NAME_REPLY,
  RUN_REQUIRES_NAME_REPLY,
  UNSET_IDEA_REPLY,
  UNSET_INSTRUCTIONS_REPLY,
  UPDATED_IDEA_REPLY,
  UPDATED_INSTRUCTIONS_REPLY,
};
export type { OwnerCommand, OwnerCommandDeps, OwnerCommandPrisma };
