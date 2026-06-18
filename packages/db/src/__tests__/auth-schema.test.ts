import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { account, orgMembership, organization, session, user, verification } from "../schema";

// Minimal integration smoke tests — runs against the real DB.
// DATABASE_URL must point to a running Postgres instance.

const makeUserId = () => createId();

describe.skipIf(!process.env.DATABASE_URL)("db integration", () => {
  const insertedUserIds: string[] = [];

  afterEach(async () => {
    // Clean up in FK-safe order
    for (const id of insertedUserIds) {
      await db.delete(orgMembership).where(eq(orgMembership.userId, id));
      await db.delete(session).where(eq(session.userId, id));
      await db.delete(account).where(eq(account.userId, id));
      await db.delete(user).where(eq(user.id, id));
    }
    insertedUserIds.length = 0;
  });

  it("round-trips a User row", async () => {
    const id = makeUserId();
    insertedUserIds.push(id);
    const email = `test-${id}@example.com`;
    const [inserted] = await db
      .insert(user)
      .values({ id, email, name: "Test User", emailVerified: false })
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
    await db.insert(user).values({ id: id1, email, name: "A", emailVerified: false });
    await expect(
      db.insert(user).values({ id: id2, email, name: "B", emailVerified: false }),
    ).rejects.toThrow();
  });

  it("round-trips a Session row with cascade delete", async () => {
    const userId = makeUserId();
    insertedUserIds.push(userId);
    await db.insert(user).values({ id: userId, email: `s-${userId}@example.com`, name: "Sess User", emailVerified: false });
    const token = `tok-${createId()}`;
    const [sess] = await db
      .insert(session)
      .values({
        userId,
        token,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
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
    await db.insert(user).values({ id: userId, email: `st-${userId}@example.com`, name: "T", emailVerified: false });
    const token = `tok-${createId()}`;
    const exp = new Date(Date.now() + 86400000).toISOString();
    await db.insert(session).values({ userId, token, expiresAt: exp });
    await expect(
      db.insert(session).values({ userId, token, expiresAt: exp }),
    ).rejects.toThrow();
  });

  it("round-trips OrgMembership and enforces uniqueness", async () => {
    const userId = makeUserId();
    insertedUserIds.push(userId);
    const orgId = makeUserId();
    await db.insert(user).values({ id: userId, email: `om-${userId}@example.com`, name: "OM", emailVerified: false });
    await db.insert(organization).values({ id: orgId, name: "Org Test", slug: `org-${orgId}` });
    const [mem] = await db
      .insert(orgMembership)
      .values({ userId, orgId, role: "OWNER" })
      .returning();
    expect(mem.role).toBe("OWNER");
    // Duplicate membership should fail
    await expect(
      db.insert(orgMembership).values({ userId, orgId, role: "STAFF" }),
    ).rejects.toThrow();
    // Cleanup org
    await db.delete(orgMembership).where(eq(orgMembership.orgId, orgId));
    await db.delete(organization).where(eq(organization.id, orgId));
  });
});
