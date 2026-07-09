import { assertTemplatesEntitledForCompany, getTemplate, type Template } from "#/db/template";

type MaterializeInput = {
  companyId: string;
  templateIds: ReadonlyArray<string>;
};

type MaterializeResult = {
  correspondentId: string;
  teamId: string;
  workerIds: ReadonlyArray<string>;
};

type Color = "white" | "gray" | "black";

const isAcyclic = (edges: ReadonlyMap<string, ReadonlyArray<string>>): boolean => {
  const colors = new Map<string, Color>();
  for (const node of edges.keys()) {
    colors.set(node, "white");
  }
  const visit = (node: string): boolean => {
    colors.set(node, "gray");
    for (const next of edges.get(node) ?? []) {
      const c = colors.get(next) ?? "white";
      if (c === "gray") {
        return false;
      }
      if (c === "white" && !visit(next)) {
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

const correspondentIdFor = (companyId: string): string => `corr-${companyId}`;
const workerIdFor = (templateId: string, companyId: string): string =>
  `worker-${templateId}-${companyId}`;
const teamIdFor = (companyId: string): string => `team-${companyId}`;

const materializeTeam = async (
  db: D1Database,
  input: MaterializeInput,
): Promise<MaterializeResult> => {
  if (input.templateIds.length === 0) {
    throw new Error("materializeTeam requires at least one templateId");
  }

  const fetched = await Promise.all(input.templateIds.map((id) => getTemplate(db, id)));
  const templates: Array<Template> = [];
  for (const [i, t] of fetched.entries()) {
    if (!t) {
      throw new Error(`Template ${input.templateIds[i]} not found`);
    }
    templates.push(t);
  }

  await assertTemplatesEntitledForCompany(
    db,
    input.companyId,
    templates.map((t) => t.id),
  );

  const correspondentId = correspondentIdFor(input.companyId);
  const workerIds = templates.map((t) => workerIdFor(t.id, input.companyId));
  const teamId = teamIdFor(input.companyId);
  const now = Date.now();

  const graph = new Map<string, ReadonlyArray<string>>([[correspondentId, workerIds]]);
  for (const wid of workerIds) {
    graph.set(wid, []);
  }
  if (!isAcyclic(graph)) {
    throw new Error("Delegation graph contains a cycle");
  }

  const statements: Array<D1PreparedStatement> = [
    db
      .prepare(
        "INSERT OR IGNORE INTO team (id, company_id, confirmed_at, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(teamId, input.companyId, now, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO agent_instance
           (id, company_id, role, template_id, template_version, display_name,
            model_override, status, created_at, updated_at)
         VALUES (?, ?, 'correspondent', NULL, NULL, ?, NULL, 'active', ?, ?)`,
      )
      .bind(correspondentId, input.companyId, "Correspondente", now, now),
  ];
  templates.forEach((template, i) => {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO agent_instance
             (id, company_id, role, template_id, template_version, display_name,
              model_override, status, created_at, updated_at)
           VALUES (?, ?, 'worker', ?, ?, ?, NULL, 'active', ?, ?)`,
        )
        .bind(
          workerIds[i],
          input.companyId,
          template.id,
          template.version,
          template.displayName,
          now,
          now,
        ),
    );
  });
  statements.push(
    db
      .prepare(
        "INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, ?)",
      )
      .bind(teamId, correspondentId, JSON.stringify(workerIds)),
  );
  for (const wid of workerIds) {
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, '[]')",
        )
        .bind(teamId, wid),
    );
  }

  await db.batch(statements);

  return { correspondentId, teamId, workerIds };
};

const getDelegationTargets = async (
  db: D1Database,
  agentInstanceId: string,
): Promise<ReadonlyArray<string> | null> => {
  const row = await db
    .prepare("SELECT can_delegate_to FROM team_member WHERE agent_instance_id = ?")
    .bind(agentInstanceId)
    .first<{ can_delegate_to: string }>();
  if (!row) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.can_delegate_to) as unknown;
    return Array.isArray(parsed)
      ? (parsed.filter((v) => typeof v === "string") as Array<string>)
      : [];
  } catch {
    return [];
  }
};

export { correspondentIdFor, getDelegationTargets, isAcyclic, materializeTeam, teamIdFor };
export type { MaterializeInput, MaterializeResult };
