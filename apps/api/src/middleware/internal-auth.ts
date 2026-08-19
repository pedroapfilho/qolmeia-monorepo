import { verifyInternalSecret } from "@repo/internal-auth";
import { createMiddleware } from "hono/factory";

import { env } from "@/lib/env";

const requireInternalAuth = createMiddleware(async (c, next) => {
  const result = verifyInternalSecret({
    expected: env.INTERNAL_SHARED_SECRET,
    header: c.req.header("Authorization"),
  });
  if (result.kind === "disabled") {
    return c.json({ error: "Internal endpoint disabled" }, 503);
  }
  if (result.kind === "forbidden") {
    return c.json({ error: "Forbidden" }, 403);
  }
  // oxlint-disable-next-line node/callback-return -- Hono middleware must await downstream handlers before returning control to the framework.
  await next();
  return undefined;
});

export { requireInternalAuth };
