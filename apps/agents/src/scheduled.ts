import { dispatch } from "@flue/runtime";

import { CorrespondentV2 } from "#/agents/correspondent";
import { getDb } from "#/db/client";
import { briefCompleteness, parseBrief } from "#/lib/company-brief";
import { logInfo } from "#/lib/logger";
import {
  lastProactiveSuggestionAt,
  PROACTIVE_PROMPT,
  proactiveGate,
  recordProactiveSuggestion,
} from "#/lib/proactive";

const runProactiveSweep = async (
  env: Env,
): Promise<{ errored: number; skipped: number; suggested: number }> => {
  const results = await getDb(env).company.findMany({
    select: { brief: true, id: true },
    where: { status: "active" },
  });

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
      // Signal, not a user turn: see presentToCustomer in worker-job-steps.
      await dispatch(CorrespondentV2, {
        id: company.id,
        message: { body: PROACTIVE_PROMPT, kind: "signal", type: "proactive.nudge" },
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
