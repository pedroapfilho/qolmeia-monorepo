import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import type { DecisionOutcome } from "#/db/action";
import { generateDeliverable } from "#/jobs/worker-job-generate";
import {
  applyDecision,
  type DecisionEvent,
  type GenerateResult,
  type JobContext,
  logRevisionCapped,
  MAX_REVISIONS,
  proposeDeliverable,
  type ProposeResult,
} from "#/jobs/worker-job-steps";
import { logInfo } from "#/lib/logger";

type WorkerJobParams = {
  agentInstanceId: string;
  companyId: string;
  ticketId: string;
};

const isRevisionCapReached = (round: number, decision: DecisionOutcome): boolean =>
  decision === "changes_requested" && round >= MAX_REVISIONS;

class WorkerJobWorkflow extends WorkflowEntrypoint<Env, WorkerJobParams> {
  // fallow-ignore-next-line unused-class-member
  async run(event: Readonly<WorkflowEvent<WorkerJobParams>>, step: WorkflowStep): Promise<unknown> {
    const { agentInstanceId, companyId, ticketId } = event.payload;
    const ctx: JobContext = { agentInstanceId, companyId, env: this.env, ticketId };
    const workflowStart = Date.now();

    logInfo("workflow.start", { agentInstanceId, companyId, ticketId });

    let revision = 0;
    let priorSummary: string | null = null;
    let latestFeedback: string | null = null;

    /* oxlint-disable no-await-in-loop, react-doctor/async-await-in-loop */
    for (;;) {
      const round = revision;
      const priorForRound = priorSummary;
      const feedbackForRound = latestFeedback;

      const current = await step.do(
        `generate-${round}`,
        (): Promise<GenerateResult> =>
          generateDeliverable(ctx, round, priorForRound, feedbackForRound),
      );

      const proposed = await step.do(
        `propose-${round}`,
        (): Promise<ProposeResult> => proposeDeliverable(ctx, round, feedbackForRound, current),
      );

      if (proposed.actionId === null || proposed.actionId === "") {
        logInfo("workflow.done.nogate", {
          agentInstanceId,
          companyId,
          durationMs: Date.now() - workflowStart,
          policy: proposed.policy,
          ticketId,
        });
        return { ok: true, summary: current.summary };
      }

      const actionId = proposed.actionId;
      logInfo("workflow.waiting", {
        actionId,
        agentInstanceId,
        companyId,
        revision: round,
        ticketId,
      });

      const evt = await step.waitForEvent<DecisionEvent>(`wait-${actionId}`, {
        timeout: "60 days",
        type: `decision:${actionId}`,
      });

      const decision = await step.do(
        `decide-${round}`,
        (): Promise<DecisionOutcome> => applyDecision(ctx, actionId, current, evt.payload),
      );

      if (decision === "approved" || decision === "rejected") {
        logInfo("workflow.ok", {
          agentInstanceId,
          companyId,
          decision,
          durationMs: Date.now() - workflowStart,
          revisions: round,
          ticketId,
        });
        return { decision, revisions: round, summary: current.summary };
      }

      priorSummary = current.summary;
      latestFeedback = evt.payload.feedback ?? null;
      revision = round + 1;

      if (isRevisionCapReached(round, decision)) {
        await step.do("revise-capped", () => logRevisionCapped(ctx, actionId));
        logInfo("workflow.revise.capped", { companyId, revision, ticketId });
        return { decision, revisionCapped: true, revisions: round, summary: current.summary };
      }
      logInfo("workflow.revise", { companyId, revision, ticketId });
    }
    /* oxlint-enable no-await-in-loop */
  }
}

export { buildRevisionMessages } from "#/jobs/worker-job-generate";
export { MAX_REVISIONS } from "#/jobs/worker-job-steps";
export { isRevisionCapReached, WorkerJobWorkflow };
export type { WorkerJobParams };
