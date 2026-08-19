import type { PrismaClient } from "@repo/db";
import { companyBriefSchema } from "@repo/worker-api/brief";
import { z } from "zod";

import {
  decideAction,
  getAction,
  listActions,
  listActionsForTicket,
  listActivity,
  listPendingActions,
  logActivity,
  markExecuted,
  proposeAction,
} from "./actions";
import {
  getCompany,
  getCustomerCompany,
  insertMemoryFact,
  lastProactiveSuggestionAt,
  listCompaniesOverview,
  listProactiveCompanies,
  provisionCompany,
  updateCompanyBrief,
} from "./companies";
import { assignmentOptions, listCoverage } from "./team-read";
import { setCoverage } from "./team-write";
import {
  createTemplate,
  getTemplate,
  listAllTemplates,
  listEntitledActiveTemplates,
  listSkillOverlays,
  setTemplateStatus,
  updateTemplate,
} from "./templates";
import {
  createDelegatedTicket,
  listTickets,
  listWorkerCandidates,
  loadAgentInstance,
  loadInstanceWithTemplate,
  loadTicket,
  setTicketWorkflowId,
  transitionTicket,
} from "./tickets";
import { AgentDataError } from "./types";

const emptySchema = z.object({});
const companyIdSchema = z.object({ companyId: z.string().min(1) });
const actionIdSchema = z.object({ actionId: z.string().min(1) });
const ticketIdSchema = z.object({ ticketId: z.string().min(1) });
const templateIdSchema = z.object({ templateId: z.string().min(1) });
const jsonRecordSchema = z.record(z.string(), z.json());
const coverageSchema = z.object({
  companies: z.array(z.string()),
  disciplines: z.array(z.string()),
});
const activitySchema = z.object({
  actorId: z.string().optional(),
  companyId: z.string().min(1),
  payload: jsonRecordSchema.optional(),
  refId: z.string().optional(),
  refType: z.string().optional(),
  summary: z.string(),
  type: z.string().min(1),
});
const activityOptionsSchema = z.object({
  before: z.number().optional(),
  category: z.enum(["ACTION", "MEMBER", "TEAM", "TICKET", "WORKER"]).optional(),
  companyId: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
  since: z.number().optional(),
});
const templateInputSchema = z.object({
  defaultActionType: z.string(),
  defaultPolicies: z.record(z.string(), z.string()),
  description: z.string(),
  displayName: z.string(),
  model: z.string(),
  skillIds: z.array(z.string()),
  systemPrompt: z.string(),
  workerKind: z.string(),
});
const ticketStatusSchema = z.enum([
  "awaiting_approval",
  "blocked",
  "cancelled",
  "done",
  "in_progress",
  "open",
  "rejected",
]);

const dispatchActionOperation = async (db: PrismaClient, operation: string, raw: unknown) => {
  switch (operation) {
    case "actions.decide": {
      const input = z
        .object({
          actionId: z.string().min(1),
          decidedByUserId: z.string().min(1),
          decision: z.enum(["approved", "changes_requested", "rejected"]),
          feedback: z.string().optional(),
        })
        .parse(raw);
      return decideAction(db, input);
    }
    case "actions.get": {
      const input = actionIdSchema.parse(raw);
      return getAction(db, input.actionId);
    }
    case "actions.list": {
      const input = z
        .object({ companyId: z.string().optional(), limit: z.number().int().positive().optional() })
        .parse(raw);
      return listActions(db, input);
    }
    case "actions.listForTicket": {
      const input = ticketIdSchema.parse(raw);
      return listActionsForTicket(db, input.ticketId);
    }
    case "actions.listPending": {
      const input = z
        .object({
          companyId: z.string().optional(),
          companyIds: z.array(z.string()).optional(),
          disciplines: z.array(z.string()).optional(),
          limit: z.number().int().positive().optional(),
        })
        .parse(raw);
      return listPendingActions(db, input);
    }
    case "actions.markExecuted": {
      const input = actionIdSchema.parse(raw);
      await markExecuted(db, input.actionId);
      return null;
    }
    case "actions.propose": {
      const input = z
        .object({
          actionType: z.string().min(1),
          companyId: z.string().min(1),
          policy: z.enum(["auto_execute", "notify_only", "require_approval"]),
          proposed: jsonRecordSchema,
          ticketId: z.string().min(1),
        })
        .parse(raw);
      return proposeAction(db, input);
    }
    case "activity.list": {
      return listActivity(db, activityOptionsSchema.parse(raw));
    }
    case "activity.log": {
      await logActivity(db, activitySchema.parse(raw));
      return null;
    }
    default: {
      throw new AgentDataError("unknown_operation", `Unknown operation: ${operation}`, 404);
    }
  }
};

const dispatchCompanyOperation = async (db: PrismaClient, operation: string, raw: unknown) => {
  switch (operation) {
    case "assignments.get": {
      const input = z.object({ operatorUserId: z.string().min(1) }).parse(raw);
      return listCoverage(db, input.operatorUserId);
    }
    case "assignments.options": {
      emptySchema.parse(raw);
      return assignmentOptions(db);
    }
    case "assignments.set": {
      const input = z
        .object({
          coverage: coverageSchema,
          operatorUserId: z.string().min(1),
        })
        .parse(raw);
      await setCoverage(db, input.operatorUserId, input.coverage);
      return null;
    }
    case "companies.get": {
      const input = companyIdSchema.parse(raw);
      return getCompany(db, input.companyId);
    }
    case "companies.getCustomer": {
      const input = companyIdSchema.parse(raw);
      return getCustomerCompany(db, input.companyId);
    }
    case "companies.listOverview": {
      emptySchema.parse(raw);
      return listCompaniesOverview(db);
    }
    case "companies.listProactive": {
      emptySchema.parse(raw);
      return listProactiveCompanies(db);
    }
    case "companies.provision": {
      const input = z
        .object({ id: z.string().min(1), name: z.string().min(1), slug: z.string().min(1) })
        .parse(raw);
      return provisionCompany(db, input);
    }
    case "companies.updateBrief": {
      const input = z
        .object({ companyId: z.string().min(1), updates: companyBriefSchema.partial() })
        .parse(raw);
      return updateCompanyBrief(db, input.companyId, input.updates);
    }
    case "memory.insert": {
      const input = z
        .object({
          agentInstanceId: z.string().min(1),
          companyId: z.string().min(1),
          content: z.string().min(1),
          id: z.string().min(1),
          kind: z.string().min(1),
          salience: z.number().optional(),
        })
        .parse(raw);
      await insertMemoryFact(db, input);
      return null;
    }
    case "proactive.lastSuggestedAt": {
      const input = companyIdSchema.parse(raw);
      return lastProactiveSuggestionAt(db, input.companyId);
    }
    default: {
      throw new AgentDataError("unknown_operation", `Unknown operation: ${operation}`, 404);
    }
  }
};

const dispatchTemplateTicketOperation = async (
  db: PrismaClient,
  operation: string,
  raw: unknown,
) => {
  switch (operation) {
    case "templates.create": {
      return createTemplate(db, templateInputSchema.parse(raw));
    }
    case "templates.get": {
      const input = templateIdSchema.parse(raw);
      return getTemplate(db, input.templateId);
    }
    case "templates.listActive": {
      const input = companyIdSchema.parse(raw);
      return listEntitledActiveTemplates(db, input.companyId);
    }
    case "templates.listAll": {
      emptySchema.parse(raw);
      return listAllTemplates(db);
    }
    case "templates.overlays": {
      const input = z.object({ skillIds: z.array(z.string()) }).parse(raw);
      return listSkillOverlays(db, input.skillIds);
    }
    case "templates.setStatus": {
      const input = z
        .object({ status: z.enum(["active", "retired"]), templateId: z.string().min(1) })
        .parse(raw);
      return setTemplateStatus(db, input.templateId, input.status);
    }
    case "templates.update": {
      const input = templateInputSchema.extend({ templateId: z.string().min(1) }).parse(raw);
      const { templateId, ...template } = input;
      return updateTemplate(db, templateId, template);
    }
    case "tickets.createDelegated": {
      const input = z
        .object({
          agentInstanceId: z.string().min(1),
          brief: z.string().min(1),
          companyId: z.string().min(1),
          ticketId: z.string().min(1),
          workerKind: z.string().min(1),
        })
        .parse(raw);
      await createDelegatedTicket(db, input);
      return null;
    }
    case "tickets.list": {
      const input = z
        .object({
          companyId: z.string().optional(),
          limit: z.number().int().positive().optional(),
          status: ticketStatusSchema.optional(),
        })
        .parse(raw);
      return listTickets(db, input);
    }
    case "tickets.load": {
      const input = ticketIdSchema.parse(raw);
      return loadTicket(db, input.ticketId);
    }
    case "tickets.loadInstance": {
      const input = z.object({ agentInstanceId: z.string().min(1) }).parse(raw);
      return loadAgentInstance(db, input.agentInstanceId);
    }
    case "tickets.loadInstanceWithTemplate": {
      const input = z.object({ agentInstanceId: z.string().min(1) }).parse(raw);
      return loadInstanceWithTemplate(db, input.agentInstanceId);
    }
    case "tickets.setWorkflow": {
      const input = z
        .object({ ticketId: z.string().min(1), workflowId: z.string().min(1) })
        .parse(raw);
      await setTicketWorkflowId(db, input.ticketId, input.workflowId);
      return null;
    }
    case "tickets.transition": {
      const input = z
        .object({
          activity: activitySchema,
          result: jsonRecordSchema.optional(),
          status: ticketStatusSchema,
          ticketId: z.string().min(1),
        })
        .parse(raw);
      await transitionTicket(db, input);
      return null;
    }
    case "workers.candidates": {
      const input = z
        .object({ companyId: z.string().min(1), workerKind: z.string().min(1) })
        .parse(raw);
      return listWorkerCandidates(db, input.companyId, input.workerKind);
    }
    default: {
      throw new AgentDataError("unknown_operation", `Unknown operation: ${operation}`, 404);
    }
  }
};

export { dispatchActionOperation, dispatchCompanyOperation, dispatchTemplateTicketOperation };
