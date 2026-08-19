import { prisma } from "@repo/db";
import { Hono } from "hono";
import { ZodError } from "zod";

import {
  dispatchActionOperation,
  dispatchCompanyOperation,
  dispatchTemplateTicketOperation,
} from "@/data/agents/dispatch";
import { dispatchAssetOperation, dispatchTeamOperation } from "@/data/agents/dispatch-team-assets";
import { dispatchWorkflowOperation } from "@/data/agents/dispatch-workflows";
import { AgentDataError } from "@/data/agents/types";
import { requireInternalAuth } from "@/middleware/internal-auth";

const agentsInternalRoutes = new Hono();

agentsInternalRoutes.use("*", requireInternalAuth);

agentsInternalRoutes.post("/:operation", async (c) => {
  const operation = c.req.param("operation");
  const raw: unknown = await c.req.json().catch(() => null);
  try {
    let result: unknown;
    if (operation.startsWith("actions.") || operation.startsWith("activity.")) {
      result = await dispatchActionOperation(prisma, operation, raw);
    } else if (
      operation.startsWith("assignments.") ||
      operation.startsWith("companies.") ||
      operation.startsWith("memory.") ||
      operation.startsWith("proactive.")
    ) {
      result = await dispatchCompanyOperation(prisma, operation, raw);
    } else if (
      operation.startsWith("templates.") ||
      operation.startsWith("tickets.") ||
      operation.startsWith("workers.")
    ) {
      result = await dispatchTemplateTicketOperation(prisma, operation, raw);
    } else if (operation.startsWith("assets.")) {
      result = await dispatchAssetOperation(prisma, operation, raw);
    } else if (operation.startsWith("teams.")) {
      result = await dispatchTeamOperation(prisma, operation, raw);
    } else if (operation.startsWith("workflows.")) {
      result = await dispatchWorkflowOperation(prisma, operation, raw);
    } else {
      throw new AgentDataError("unknown_operation", `Unknown operation: ${operation}`, 404);
    }
    return c.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return c.json({ code: "invalid_input", error: "Invalid operation input" }, 400);
    }
    if (error instanceof AgentDataError) {
      return c.json({ code: error.code, error: error.message }, error.status);
    }
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

export { agentsInternalRoutes };
