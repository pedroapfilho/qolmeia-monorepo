import { getAgentByName } from "agents";

import { briefCompleteness, parseBrief } from "@/lib/company-brief";
import { logInfo } from "@/lib/logger";

// Weekly proactive "suggest next work" sweep, driven by the Worker cron trigger
// (see wrangler.jsonc `triggers.crons`). Wakes each active company's
// Correspondent DO; the DO is the authoritative guard for brief-completeness and
// weekly de-duplication, so this stays a cheap fan-out. Per-DO failures are
// isolated via allSettled — one company never blocks the rest.
const runProactiveSweep = async (
  env: Env,
): Promise<{ errored: number; skipped: number; suggested: number }> => {
  const { results } = await env.DB.prepare(
    `SELECT id, brief FROM company WHERE status = 'active'`,
  ).all<{ brief: string | null; id: string }>();

  // Cheap pre-filter so we only wake DOs that can possibly suggest. The DO
  // re-checks completeness + the weekly window before messaging.
  const eligible = results.filter((row) => briefCompleteness(parseBrief(row.brief)).isComplete);

  const outcomes = await Promise.allSettled(
    eligible.map(async (company) => {
      const stub = await getAgentByName(env.CORRESPONDENT, company.id);
      return stub.suggestNextWork();
    }),
  );

  let suggested = 0;
  let skipped = 0;
  let errored = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      errored += 1;
    } else if (outcome.value.status === "suggested") {
      suggested += 1;
    } else {
      skipped += 1;
    }
  }

  logInfo("agent.proactiveSweep.done", {
    eligible: eligible.length,
    errored,
    scanned: results.length,
    skipped,
    suggested,
  });
  return { errored, skipped, suggested };
};

export { runProactiveSweep };
