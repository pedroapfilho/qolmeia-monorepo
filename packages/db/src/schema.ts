import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const orgRole = pgEnum("OrgRole", ["OWNER", "STAFF", "CUSTOMER"]);

export const organization = pgTable(
  "Organization",
  {
    createdAt: timestamp({ mode: "string", precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    currency: text().notNull().default("BRL"),
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    name: text().notNull(),
    slug: text().notNull(),
    timezone: text().notNull().default("America/Sao_Paulo"),
    updatedAt: timestamp({ mode: "string", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
  },
  (table) => [
    index("Organization_slug_idx").using("btree", table.slug.asc().nullsLast().op("text_ops")),
    uniqueIndex("Organization_slug_key").using(
      "btree",
      table.slug.asc().nullsLast().op("text_ops"),
    ),
  ],
);

export const user = pgTable(
  "User",
  {
    createdAt: timestamp({ mode: "string", precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    displayName: text(),
    displayUsername: text(),
    email: text().notNull(),
    emailVerified: boolean().default(false).notNull(),
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    image: text(),
    name: text().notNull(),
    updatedAt: timestamp({ mode: "string", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
    username: text(),
  },
  (table) => [
    index("User_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
    uniqueIndex("User_email_key").using("btree", table.email.asc().nullsLast().op("text_ops")),
    uniqueIndex("User_username_key").using(
      "btree",
      table.username.asc().nullsLast().op("text_ops"),
    ),
  ],
);

export const session = pgTable(
  "Session",
  {
    createdAt: timestamp({ mode: "string", precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp({ mode: "string", precision: 3 }).notNull(),
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    impersonatedBy: text(),
    ipAddress: text(),
    token: text().notNull(),
    updatedAt: timestamp({ mode: "string", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
    userAgent: text(),
    userId: text().notNull(),
  },
  (table) => [
    uniqueIndex("Session_token_key").using("btree", table.token.asc().nullsLast().op("text_ops")),
    index("Session_userId_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "Session_userId_fkey",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

export const account = pgTable(
  "Account",
  {
    accessToken: text(),
    accessTokenExpiresAt: timestamp({ mode: "string", precision: 3 }),
    accountId: text().notNull(),
    createdAt: timestamp({ mode: "string", precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    idToken: text(),
    password: text(),
    providerId: text().notNull(),
    refreshToken: text(),
    refreshTokenExpiresAt: timestamp({ mode: "string", precision: 3 }),
    scope: text(),
    updatedAt: timestamp({ mode: "string", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
    userId: text().notNull(),
  },
  (table) => [
    index("Account_providerId_accountId_idx").using(
      "btree",
      table.providerId.asc().nullsLast().op("text_ops"),
      table.accountId.asc().nullsLast().op("text_ops"),
    ),
    index("Account_userId_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "Account_userId_fkey",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

export const verification = pgTable(
  "Verification",
  {
    createdAt: timestamp({ mode: "string", precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp({ mode: "string", precision: 3 }).notNull(),
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    identifier: text().notNull(),
    updatedAt: timestamp({ mode: "string", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
    value: text().notNull(),
  },
  (table) => [
    index("Verification_identifier_idx").using(
      "btree",
      table.identifier.asc().nullsLast().op("text_ops"),
    ),
  ],
);

export const rateLimit = pgTable(
  "RateLimit",
  {
    count: integer().notNull(),
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    key: text().notNull(),
    lastRequest: bigint({ mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("RateLimit_key_key").using("btree", table.key.asc().nullsLast().op("text_ops")),
  ],
);

export const orgMembership = pgTable(
  "OrgMembership",
  {
    createdAt: timestamp({ mode: "string", precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    orgId: text().notNull(),
    role: orgRole().notNull(),
    updatedAt: timestamp({ mode: "string", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
    userId: text().notNull(),
  },
  (table) => [
    index("OrgMembership_orgId_role_idx").using(
      "btree",
      table.orgId.asc().nullsLast().op("text_ops"),
      table.role.asc().nullsLast().op("text_ops"),
    ),
    uniqueIndex("OrgMembership_userId_orgId_key").using(
      "btree",
      table.userId.asc().nullsLast().op("text_ops"),
      table.orgId.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "OrgMembership_userId_fkey",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [organization.id],
      name: "OrgMembership_orgId_fkey",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);
