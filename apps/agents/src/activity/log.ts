import { log } from "@repo/observability";
import type { ActivityEntry } from "@repo/worker-api/contracts";
import type { ActivityInput, ActivityOptions } from "@repo/worker-api/internal";

import type { ActivityEvent } from "#/activity/types";
import type { Database } from "#/db/client";
import { toRecord } from "#/lib/records";

type LogActivityInput = ActivityEvent & {
  actorId?: string;
  companyId: string;
  summary: string;
};

const logActivity = async (db: Database, input: LogActivityInput): Promise<void> => {
  const remoteInput: ActivityInput = {
    ...input,
    payload: input.payload === undefined ? undefined : toRecord(input.payload),
  };
  try {
    await db("activity.log", remoteInput);
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      message: "activity.write_failed",
      type: input.type,
    });
  }
};

const ACTIVITY_CATEGORIES = ["ACTION", "TICKET", "WORKER", "TEAM", "MEMBER"] as const;
type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];
type ListActivityOptions = ActivityOptions & { category?: ActivityCategory };

const listActivity = (
  db: Database,
  options: ListActivityOptions = {},
): Promise<ReadonlyArray<ActivityEntry>> => db("activity.list", options);

export { ACTIVITY_CATEGORIES, listActivity, logActivity };
export type { LogActivityInput };
