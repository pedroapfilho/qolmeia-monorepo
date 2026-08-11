import type { PrismaClient } from "@repo/db";
import { prisma as defaultPrisma } from "@repo/db";
import type { MeResponse } from "@repo/worker-api/contracts";
import { Hono } from "hono";

import { notFound } from "@/lib/api-response";
import type { DiscoveryContextVars } from "@/middleware/require-staff";

type MePrisma = Pick<PrismaClient, "orgMembership" | "user">;

type MeRouteDeps = {
  prisma?: MePrisma;
};

const buildMeRoutes = (deps: MeRouteDeps = {}): Hono<{ Variables: DiscoveryContextVars }> => {
  const prisma = deps.prisma ?? defaultPrisma;
  const app = new Hono<{ Variables: DiscoveryContextVars }>();

  app.get("/", async (c) => {
    const session = c.get("session");
    const currentOrgId = c.get("orgId");
    const role = c.get("role");

    const [user, memberships] = await Promise.all([
      prisma.user.findUnique({
        select: {
          displayName: true,
          email: true,
          emailVerified: true,
          id: true,
          image: true,
          name: true,
          username: true,
        },
        where: { id: session.user.id },
      }),
      prisma.orgMembership.findMany({
        include: {
          org: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: "asc" },
        where: { userId: session.user.id },
      }),
    ]);

    if (!user) {
      return notFound(c, "User not found");
    }

    const currentOrgRow = memberships.find((m) => m.orgId === currentOrgId);

    const body: MeResponse = {
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
        displayName: user.displayName,
        email: user.email,
        emailVerified: user.emailVerified,
        id: user.id,
        image: user.image,
        name: user.name,
        username: user.username,
      },
    };

    return c.json(body);
  });

  return app;
};

export { buildMeRoutes };
export type { MeRouteDeps };
