import type { Action, DecisionOutcome } from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";
import type { Policy } from "#/db/policy";

type ProposeActionInput = {
  actionType: string;
  companyId: string;
  policy: Policy;
  proposed: Record<string, unknown>;
  ticketId: string;
};

type DecideActionInput = {
  actionId: string;
  decidedByUserId: string;
  decision: DecisionOutcome;
  feedback?: string;
};

const proposeAction = (db: Database, input: ProposeActionInput): Promise<{ id: string }> =>
  db("actions.propose", input);

const decideAction = (db: Database, input: DecideActionInput): Promise<boolean> =>
  db("actions.decide", input);

const markExecuted = async (db: Database, actionId: string): Promise<void> => {
  await db("actions.markExecuted", { actionId });
};

const getAction = (db: Database, actionId: string): Promise<Action | null> =>
  db("actions.get", { actionId });

type PendingOptions = {
  companyId?: string;
  companyIds?: ReadonlyArray<string>;
  disciplines?: ReadonlyArray<string>;
  limit?: number;
};

const listPendingActions = (
  db: Database,
  options: PendingOptions = {},
): Promise<ReadonlyArray<Action>> => db("actions.listPending", options);

const listActions = (
  db: Database,
  options: { companyId?: string; limit?: number } = {},
): Promise<ReadonlyArray<Action>> => db("actions.list", options);

const listActionsForTicket = (db: Database, ticketId: string): Promise<ReadonlyArray<Action>> =>
  db("actions.listForTicket", { ticketId });

export {
  decideAction,
  getAction,
  listActions,
  listActionsForTicket,
  listPendingActions,
  markExecuted,
  proposeAction,
};
export type { DecideActionInput, ProposeActionInput };
