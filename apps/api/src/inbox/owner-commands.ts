import type { PrismaClient } from "@repo/db";

type OwnerCommand =
  | { kind: "get-idea" }
  | { kind: "get-instructions" }
  | { kind: "set-idea"; value: string }
  | { kind: "set-instructions"; value: string };

const UNSET_INSTRUCTIONS_REPLY = "Ainda não definidas. Use `/instrucoes <texto>` para configurar.";
const UNSET_IDEA_REPLY = "Ainda não definida. Use `/ideia <texto>` para configurar.";
const UPDATED_INSTRUCTIONS_REPLY = "Instruções atualizadas.";
const UPDATED_IDEA_REPLY = "Ideia do negócio atualizada.";

/**
 * Parses owner-only Telegram slash commands. Returns null when the text isn't
 * a recognised command (so the pipeline forwards it to the agent runtime).
 *
 * - `/instrucoes` (alone) — read current Organization.agentInstructions
 * - `/instrucoes <text>` — set Organization.agentInstructions to <text>
 * - `/ideia` (alone) — read current Organization.businessIdea
 * - `/ideia <text>` — set Organization.businessIdea to <text>
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
  return null;
};

type OwnerCommandPrisma = Pick<PrismaClient, "organization">;

const handleOwnerCommand = async ({
  command,
  orgId,
  prisma,
}: {
  command: OwnerCommand;
  orgId: string;
  prisma: OwnerCommandPrisma;
}): Promise<string> => {
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
  // command.kind === "set-idea"
  await prisma.organization.update({
    data: { businessIdea: command.value },
    where: { id: orgId },
  });
  return UPDATED_IDEA_REPLY;
};

export {
  handleOwnerCommand,
  parseOwnerCommand,
  UNSET_IDEA_REPLY,
  UNSET_INSTRUCTIONS_REPLY,
  UPDATED_IDEA_REPLY,
  UPDATED_INSTRUCTIONS_REPLY,
};
export type { OwnerCommand, OwnerCommandPrisma };
