import "./fields";

import { createLogger, initLogger } from "evlog";

import { buildConfig } from "./config";

const initWorkerLogger = (opts: { service: string }): void => {
  initLogger(buildConfig(opts.service));
};

type JobLogValue = boolean | number | string | null | undefined;
type JobLogContext = Readonly<Record<string, JobLogValue>>;

const createJobLogger = (ctx: JobLogContext) => createLogger(ctx);

export { createJobLogger, initWorkerLogger };
