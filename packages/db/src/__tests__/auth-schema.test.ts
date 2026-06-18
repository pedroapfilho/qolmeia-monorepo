import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { afterEach, describe, it, expect } from "vitest";

import { db } from "../client";
import { account, orgMembership, organization, session, user } from "../schema";

// Minimal integration smoke tests — runs against the real DB.
// DATABASE_URL must point to a running Postgres instance.

const makeUserId = () => createId();

describe.skipIf(!process.env.DATABASE_URL)("db integration", () => {
  const insertedUserIds: Array<string> = [];

  afterEach(async () => {
    // Clean up in FK-safe order: delete child rows across all users first, then parent rows.
    const ids = [...insertedUserIds];
    await Promise.allSettled(
      ids.map((id) => db.delete(orgMembership).where(eq(orgMembership.userId, id))),
    );
    await Promise.allSettled(ids.map((id) => db.delete(session).where(eq(session.userId, id))));
    await Promise.allSettled(ids.map((id) => db.delete(account).where(eq(account.userId, id))));
    await Promise.allSettled(ids.map((id) => db.delete(user).where(eq(user.id, id))));
    insertedUserIds.length = 0;
  });

  it("round-trips a User row", async () => {
    const id = makeUserId();
    insertedUserIds.push(id);
    const email = `test-${id}@example.com`;
    const [inserted] = await db
      .insert(user)
      .values({ email, emailVerified: false, id, name: "Test User" })
      .returning();
    expect(inserted.email).toBe(email);
    const [fetched] = await db.select().from(user).where(eq(user.id, id));
    expect(fetched.name).toBe("Test User");
  });

  it("enforces unique email on User", async () => {
    const id1 = makeUserId();
    const id2 = makeUserId();
    insertedUserIds.push(id1, id2);
    const email = `dup-${id1}@example.com`;
    await db.insert(user).values({ email, emailVerified: false, id: id1, name: "A" });
    await expect(
      db.insert(user).values({ email, emailVerified: false, id: id2, name: "B" }),
    ).rejects.toThrow();
  });

  it("round-trips a Session row with cascade delete", async () => {
    const userId = makeUserId();
    insertedUserIds.push(userId);
    await db.insert(user).values({
      email: `s-${userId}@example.com`,
      emailVerified: false,
      id: userId,
      name: "Sess User",
    });
    const token = `tok-${createId()}`;
    const [sess] = await db
      .insert(session)
      .values({
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        token,
        userId,
      })
      .returning();
    expect(sess.token).toBe(token);
    // Delete user cascades session
    await db.delete(user).where(eq(user.id, userId));
    insertedUserIds.splice(insertedUserIds.indexOf(userId), 1);
    const sessions = await db.select().from(session).where(eq(session.token, token));
    expect(sessions).toHaveLength(0);
  });

  it("enforces unique Session token", async () => {
    const userId = makeUserId();
    insertedUserIds.push(userId);
    await db
      .insert(user)
      .values({ email: `st-${userId}@example.com`, emailVerified: false, id: userId, name: "T" });
    const token = `tok-${createId()}`;
    const exp = new Date(Date.now() + 86_400_000).toISOString();
    await db.insert(session).values({ expiresAt: exp, token, userId });
    await expect(db.insert(session).values({ expiresAt: exp, token, userId })).rejects.toThrow();
  });

  it("round-trips OrgMembership and enforces uniqueness", async () => {
    const userId = makeUserId();
    insertedUserIds.push(userId);
    const orgId = makeUserId();
    await db
      .insert(user)
      .values({ email: `om-${userId}@example.com`, emailVerified: false, id: userId, name: "OM" });
    await db.insert(organization).values({ id: orgId, name: "Org Test", slug: `org-${orgId}` });
    const [mem] = await db
      .insert(orgMembership)
      .values({ orgId, role: "OWNER", userId })
      .returning();
    expect(mem.role).toBe("OWNER");
    // Duplicate membership should fail
    await expect(
      db.insert(orgMembership).values({ orgId, role: "STAFF", userId }),
    ).rejects.toThrow();
    // Cleanup org
    await db.delete(orgMembership).where(eq(orgMembership.orgId, orgId));
    await db.delete(organization).where(eq(organization.id, orgId));
  });
});
