import type { PrismaClient } from "@repo/db";
import { z } from "zod";

import { AgentDataError } from "./types";
import { applyWorkflowDecision, completeWorkflow, proposeWorkflow } from "./workflows";

const jsonRecordSchema = z.record(z.string(), z.json());

const dispatchWorkflowOperation = async (db: PrismaClient, operation: string, raw: unknown) => {
  switch (operation) {
    case "workflows.applyDecision": {
      const input = z
        .object({
          actionId: z.string().min(1),
          companyId: z.string().min(1),
          decidedByUserId: z.string().min(1),
          decision: z.enum(["approved", "changes_requested", "rejected"]),
          feedback: z.string().optional(),
          summary: z.string(),
          ticketId: z.string().min(1),
        })
        .parse(raw);
      await applyWorkflowDecision(db, input);
      return null;
    }
    case "workflows.complete": {
      const input = z
        .object({
          companyId: z.string().min(1),
          policy: z.enum(["auto_execute", "notify_only"]),
          summary: z.string(),
          ticketId: z.string().min(1),
        })
        .parse(raw);
      await completeWorkflow(db, input);
      return null;
    }
    case "workflows.propose": {
      const input = z
        .object({
          actionType: z.string().min(1),
          companyId: z.string().min(1),
          feedback: z.string().nullable(),
          policy: z.literal("require_approval"),
          proposed: jsonRecordSchema,
          round: z.number().int().nonnegative(),
          summary: z.string(),
          ticketId: z.string().min(1),
        })
        .parse(raw);
      return proposeWorkflow(db, input);
    }
    default: {
      throw new AgentDataError("unknown_operation", `Unknown operation: ${operation}`, 404);
    }
  }
};

export { dispatchWorkflowOperation };
