import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

// Per-ticket execution unit. The Worker DO no longer runs streamText inline —
// it creates a WorkerJob Workflow instance and returns immediately. The
// Workflow drives the LLM, files gated actions, and `step.waitForEvent`-pauses
// until the User decides. Resumes survive eviction.
//
// T4 plugs in the step registry (research / generate / propose / execute).
// T5 wires the proposeAction step with waitForEvent. T1's stub keeps the
// binding referenceable so `wrangler types` generates `env.WORKER_JOB`.

type WorkerJobParams = {
  agentInstanceId: string;
  companyId: string;
  ticketId: string;
};

class WorkerJobWorkflow extends WorkflowEntrypoint<Env, WorkerJobParams> {
  run(event: Readonly<WorkflowEvent<WorkerJobParams>>, step: WorkflowStep): Promise<unknown> {
    // Stub until T4 — the real step driver lands there.
    return step.do("noop", () => Promise.resolve({ ticketId: event.payload.ticketId }));
  }
}

export { WorkerJobWorkflow };
export type { WorkerJobParams };
