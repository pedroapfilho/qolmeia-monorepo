import "dotenv/config";

import { prisma } from "@repo/db";

import { syncRoutines } from "../routines/registry";

// Mirrors the code-defined routine registry into the DB as paused-by-default
// Routine rows. Idempotent — re-running refreshes descriptions but never
// flips `enabled` or overwrites owner-customised schedule/config.
//
// Usage:
//   pnpm tsx apps/api/src/scripts/sync-routines.ts            # all orgs
//   pnpm tsx apps/api/src/scripts/sync-routines.ts <orgSlug>  # single org

const slug = process.argv[2];
let targetOrgIds: ReadonlyArray<string>;

if (slug) {
  const org = await prisma.organization.findUnique({ select: { id: true }, where: { slug } });
  if (!org) {
    console.error(`Organization with slug "${slug}" not found.`);
    process.exit(1);
  }
  targetOrgIds = [org.id];
} else {
  const all = await prisma.organization.findMany({ select: { id: true } });
  targetOrgIds = all.map((o) => o.id);
}

const result = await syncRoutines({ prisma, targetOrgIds });
console.log(
  `Synced routines: created=${result.created} skipped=${result.skipped} orgsTouched=${result.orgsTouched}`,
);

await prisma.$disconnect();
