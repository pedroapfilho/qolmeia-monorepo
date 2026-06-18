import { db as defaultDb, orgMembership, user } from "@repo/db";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { notFound } from "@/lib/api-response";
import type { AnyMemberContextVars } from "@/middleware/require-staff";

type DbLike = {
  query: {
    orgMembership: {
      findMany: (args: unknown) => Promise<
        ReadonlyArray<{
          createdAt: string;
          org: { id: string; name: string; slug: string };
          orgId: string;
          role: "OWNER" | "STAFF" | "CUSTOMER";
        }>
      >;
    };
    user: {
      findFirst: (args: unknown) => Promise<
        | {
            displayName: string | null;
            email: string;
            emailVerified: boolean;
            id: string;
            image: string | null;
            name: string;
            username: string | null;
          }
        | undefined
      >;
    };
  };
};

type MeRouteDeps = {
  db?: DbLike;
};

const buildMeRoutes = (deps: MeRouteDeps = {}): Hono<{ Variables: AnyMemberContextVars }> => {
  const db = deps.db ?? defaultDb;
  const app = new Hono<{ Variables: AnyMemberContextVars }>();

  // GET /me — the current user, their memberships, and the currently
  // selected org (today: the same one the middleware resolved; future: a
  // currentOrgId cookie).
  app.get("/", async (c) => {
    const session = c.get("session");
    const currentOrgId = c.get("orgId");
    const role = c.get("role");

    const [userRow, memberships] = await Promise.all([
      db.query.user.findFirst({
        columns: {
          displayName: true,
          email: true,
          emailVerified: true,
          id: true,
          image: true,
          name: true,
          username: true,
        },
        where: eq(user.id, session.user.id),
      }),
      db.query.orgMembership.findMany({
        orderBy: asc(orgMembership.createdAt),
        where: eq(orgMembership.userId, session.user.id),
        with: {
          org: { columns: { id: true, name: true, slug: true } },
        },
      }),
    ]);

    if (!userRow) {
      // Defensive — the middleware already resolved a session, so the user
      // row must exist. If it doesn't (race with deletion), return 404.
      return notFound(c, "User not found");
    }

    const currentOrgRow = memberships.find((m) => m.orgId === currentOrgId);

    return c.json({
      currentOrg: currentOrgRow
        ? {
            id: currentOrgRow.org.id,
            name: currentOrgRow.org.name,
            role: currentOrgRow.role,
            slug: currentOrgRow.org.slug,
          }
        : null,
      orgs: memberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        role: m.role,
        slug: m.org.slug,
      })),
      role,
      user: {
        displayName: userRow.displayName,
        email: userRow.email,
        emailVerified: userRow.emailVerified,
        id: userRow.id,
        image: userRow.image,
        name: userRow.name,
        username: userRow.username,
      },
    });
  });

  return app;
};

export { buildMeRoutes };
export type { MeRouteDeps };
