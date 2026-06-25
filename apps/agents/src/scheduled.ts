import { dispatch } from "@flue/runtime";

import { briefCompleteness, parseBrief } from "#/lib/company-brief";
import { logInfo } from "#/lib/logger";
import {
  lastProactiveSuggestionAt,
  PROACTIVE_PROMPT,
  proactiveGate,
  recordProactiveSuggestion,
} from "#/lib/proactive";

// Weekly proactive "suggest next work" sweep, driven by the Worker cron trigger
// (see wrangler.jsonc `triggers.crons`). For each eligible company it gates on
// brief-completeness + the weekly window, then dispatches PROACTIVE_PROMPT to the
// Correspondent agent. Per-company failures are isolated via allSettled.
const runProactiveSweep = async (
  env: Env,
): Promise<{ errored: number; skipped: number; suggested: number }> => {
  const { results } = await env.DB.prepare(
    `SELECT id, brief FROM company WHERE status = 'active'`,
  ).all<{ brief: string | null; id: string }>();

  const eligible = results.filter((row) => briefCompleteness(parseBrief(row.brief)).isComplete);

  const outcomes = await Promise.allSettled(
    eligible.map(async (company): Promise<"skipped" | "suggested"> => {
      const gate = proactiveGate({
        isComplete: true,
        lastSuggestedAt: await lastProactiveSuggestionAt(env, company.id),
        now: Date.now(),
      });
      if (!gate.ok) {
        return "skipped";
      }
      await dispatch({
        agent: "correspondent",
        id: company.id,
        input: { message: PROACTIVE_PROMPT },
      });
      await recordProactiveSuggestion(env, company.id);
      return "suggested";
    }),
  );

  let suggested = 0;
  let skipped = 0;
  let errored = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      errored += 1;
    } else if (outcome.value === "suggested") {
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
