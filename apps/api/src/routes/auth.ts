import { Hono } from "hono";

import { auth } from "../lib/auth";

type AuthHandler = (request: Request) => Promise<Response> | Response;

const buildAuthRoutes = (handleAuth: AuthHandler): Hono => {
  const routes = new Hono();
  routes.all("/auth/*", (c) => handleAuth(c.req.raw));
  return routes;
};

const authRoutes = buildAuthRoutes((request) => auth.handler(request));

export { authRoutes, buildAuthRoutes };
export type { AuthHandler };
