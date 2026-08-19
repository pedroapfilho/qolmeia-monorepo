import type { MaterializeResult as WorkerMaterializeResult } from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";

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

const getDelegationTargets = (
  db: Database,
  agentInstanceId: string,
): Promise<ReadonlyArray<string> | null> => db("teams.delegationTargets", { agentInstanceId });

const materializeTeam = async (
  db: Database,
  input: MaterializeInput,
): Promise<WorkerMaterializeResult> => {
  const result = await db("teams.confirm", { actorId: "system", ...input });
  return result.team;
};

export { getDelegationTargets, isAcyclic, materializeTeam };
export type { MaterializeInput };
