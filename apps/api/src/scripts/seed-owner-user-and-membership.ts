import "dotenv/config";

import crypto from "node:crypto";
import { parseArgs } from "node:util";

import { createAuth } from "@repo/auth/server";
import { prisma } from "@repo/db";

import { env } from "../lib/env";

// One-shot backfill: create an OWNER User + OrgMembership for an existing
// Organization. Run once after Phase 5b auth lands so Pedro can log into the
// backoffice with the existing org's data.
//
// Idempotent — re-running with the same email + slug updates the password
// and ensures the OWNER membership exists.
//
// We route the user creation through Better Auth's signUp.email endpoint so
// the password is bcrypt-hashed exactly like a sign-up from the UI. Doing
// the hash by hand here would diverge from production behaviour.
//
// Usage:
//   tsx apps/api/src/scripts/seed-owner-user-and-membership.ts \
//     --org-slug <slug> \
//     --email pedro@filho.me \
//     [--name "Pedro Filho"] \
//     [--password <generated if omitted>]
//
// After running:
//   1. Log into the backoffice at /login with the printed credentials.
//   2. Change the password immediately.

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    "org-slug": { type: "string" },
    password: { type: "string" },
  },
});

const orgSlug = values["org-slug"];
const email = values.email;

if (!orgSlug || !email) {
  console.error(
    "Usage: tsx apps/api/src/scripts/seed-owner-user-and-membership.ts \\\n" +
      "  --org-slug <slug> --email <email> [--name <name>] [--password <password>]",
  );
  process.exit(1);
}

const name = values.name ?? email.split("@")[0] ?? email;
// 24 url-safe chars (~144 bits). Above Better Auth's 12-char minimum and
// printable for one-shot operator handoff.
const password = values.password ?? crypto.randomBytes(18).toString("base64url");

const org = await prisma.organization.findUnique({
  select: { id: true, name: true, slug: true },
  where: { slug: orgSlug },
});
if (!org) {
  console.error(`Organization with slug "${orgSlug}" not found.`);
  console.error("Create the org first or pass a valid --org-slug.");
  process.exit(1);
}

const auth = createAuth({
  fromEmail: env.AUTH_FROM_EMAIL ?? "noreply@qolmeia.ai",
  prisma,
  resendApiKey: env.RESEND_API_KEY,
  secret: env.BETTER_AUTH_SECRET,
});

const existing = await prisma.user.findUnique({
  select: { id: true },
  where: { email },
});

let userId: string;
let action: "Created" | "Already existed";

if (existing) {
  userId = existing.id;
  action = "Already existed";
} else {
  const result = await auth.api.signUpEmail({
    body: { email, name, password },
  });
  if (!result.user?.id) {
    console.error("Better Auth signUpEmail returned no user id; aborting.");
    process.exit(1);
  }
  userId = result.user.id;
  action = "Created";
}

const membership = await prisma.orgMembership.upsert({
  create: { orgId: org.id, role: "OWNER", userId },
  select: { createdAt: true, id: true, role: true },
  update: { role: "OWNER" },
  where: { userId_orgId: { orgId: org.id, userId } },
});

console.log("");
console.log(`${action} User + OWNER OrgMembership for "${org.name}" (${org.slug}):`);
console.log(`  userId:       ${userId}`);
console.log(`  email:        ${email}`);
if (!existing) {
  console.log(`  password:     ${password}`);
}
console.log(`  orgId:        ${org.id}`);
console.log(`  membershipId: ${membership.id}`);
console.log(`  role:         ${membership.role}`);
console.log("");
console.log("Next: log into the backoffice at /login with the printed credentials");
console.log("      and change the password immediately.");

await prisma.$disconnect();
