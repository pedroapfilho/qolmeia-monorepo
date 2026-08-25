import "./fields";

import { initWorkersLogger as initEvlogWorkersLogger } from "evlog/workers";

import { buildConfig } from "./config";

// Workers runtime: Vite statically replaces process.env.NODE_ENV in the bundle,
// so buildConfig resolves the environment at build time, not from live bindings.
// pretty is forced off because wrangler tail and the Cloudflare dashboard ingest
// one JSON line per event; evlog's pretty mode writes ANSI to stdout instead of
// console, which those sinks can't parse.
const initWorkersLogger = (opts: { service: string }): void => {
  initEvlogWorkersLogger({ ...buildConfig(opts.service), pretty: false });
};

export { initWorkersLogger };
export { log } from "evlog";
