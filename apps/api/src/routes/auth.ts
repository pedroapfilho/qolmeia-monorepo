import { Hono } from "hono";

import { auth } from "../lib/auth";

// Hono adapter for Better Auth. Better Auth exposes a single Fetch-style
// handler (`auth.handler`) that owns the full /api/auth/* surface (sign-in,
// sign-up, magic-link, session, sign-out, …). We mount one catch-all that
// forwards the raw Request and returns the Response untouched so cookies,
// status codes, and streaming all pass through unchanged.
const authRoutes = new Hono();

authRoutes.all("/auth/*", (c) => auth.handler(c.req.raw));

export { authRoutes };
