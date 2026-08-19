import type { PrismaClient } from "@repo/db/worker";
import { correspondentIdFor, teamIdFor, workerIdFor } from "@repo/worker-api/contracts";
import type { MaterializeResult } from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";
import { assertTemplatesEntitledForCompany, getTemplate, type Template } from "#/db/template";

type MaterializeInput = { companyId: string; templateIds: ReadonlyArray<string> };
type Color = "black" | "gray" | "white";

const isAcyclic = (edges: ReadonlyMap<string, ReadonlyArray<string>>): boolean => {
  const colors = new Map<string, Color>();
  for (const node of edges.keys()) {
    colors.set(node, "white");
  }
  const visit = (node: string): boolean => {
    colors.set(node, "gray");
    for (const next of edges.get(node) ?? []) {
      const color = colors.get(next) ?? "white";
      if (color === "gray" || (color === "white" && !visit(next))) {
        return false;
      }
    }
    colors.set(node, "black");
    return true;
  };
  for (const node of edges.keys()) {
    if ((colors.get(node) ?? "white") === "white" && !visit(node)) {
      return false;
    }
  }
  return true;
};

const materializeTeam = async (
  db: PrismaClient,
  input: MaterializeInput,
): Promise<MaterializeResult> => {
  if (!input.templateIds.length) {
    throw new Error("materializeTeam requires at least one templateId");
  }
  const fetched = await Promise.all(input.templateIds.map((id) => getTemplate(db, id)));
  const templates: Array<Template> = [];
  for (const [index, template] of fetched.entries()) {
    if (!template) {
      throw new Error(`Template ${input.templateIds[index]} not found`);
    }
    templates.push(template);
  }
  await assertTemplatesEntitledForCompany(
    db,
    input.companyId,
    templates.map(({ id }) => id),
  );

  const correspondentId = correspondentIdFor(input.companyId);
  const workerIds = templates.map(({ id }) => workerIdFor(id, input.companyId));
  const teamId = teamIdFor(input.companyId);
  const graph = new Map<string, ReadonlyArray<string>>([[correspondentId, workerIds]]);
  for (const workerId of workerIds) {
    graph.set(workerId, []);
  }
  if (!isAcyclic(graph)) {
    throw new Error("Delegation graph contains a cycle");
  }

  await db.$transaction(async (tx) => {
    await tx.team.upsert({
      create: { companyId: input.companyId, confirmedAt: new Date(), id: teamId },
      update: { confirmedAt: new Date() },
      where: { companyId: input.companyId },
    });
    await tx.agentInstance.upsert({
      create: {
        companyId: input.companyId,
        displayName: "Correspondente",
        id: correspondentId,
        role: "correspondent",
      },
      update: {},
      where: { id: correspondentId },
    });
    await Promise.all(
      templates.map((template, index) => {
        const id = workerIds[index];
        if (!id) {
          throw new Error(`Missing worker id for template ${template.id}`);
        }
        return tx.agentInstance.upsert({
          create: {
            companyId: input.companyId,
            displayName: template.displayName,
            id,
            role: "worker",
            templateId: template.id,
            templateVersion: template.version,
          },
          update: {},
          where: { id },
        });
      }),
    );
    await tx.teamMember.upsert({
      create: { agentInstanceId: correspondentId, canDelegateTo: workerIds, teamId },
      update: { canDelegateTo: workerIds },
      where: { teamId_agentInstanceId: { agentInstanceId: correspondentId, teamId } },
    });
    await Promise.all(
      workerIds.map((agentInstanceId) =>
        tx.teamMember.upsert({
          create: { agentInstanceId, canDelegateTo: [], teamId },
          update: {},
          where: { teamId_agentInstanceId: { agentInstanceId, teamId } },
        }),
      ),
    );
  });
  return { correspondentId, teamId, workerIds };
};

const getDelegationTargets = async (
  db: Database,
  agentInstanceId: string,
): Promise<ReadonlyArray<string> | null> => {
  const row = await db.teamMember.findFirst({
    select: { canDelegateTo: true },
    where: { agentInstanceId },
  });
  if (!row) {
    return null;
  }
  return Array.isArray(row.canDelegateTo)
    ? row.canDelegateTo.filter((value): value is string => typeof value === "string")
    : [];
};

export { getDelegationTargets, isAcyclic, materializeTeam };
export { correspondentIdFor, teamIdFor } from "@repo/worker-api/contracts";
export type { MaterializeInput };
export type { MaterializeResult } from "@repo/worker-api/contracts";
