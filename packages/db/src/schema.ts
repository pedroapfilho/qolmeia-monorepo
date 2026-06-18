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
    id: text().primaryKey().notNull().$defaultFn(() => createId()),
    name: text().notNull(),
    slug: text().notNull(),
    timezone: text().notNull().default("America/Sao_Paulo"),
    currency: text().notNull().default("BRL"),
    createdAt: timestamp({ mode: "string", precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp({ mode: "string", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
  },
  (table) => [
    index("Organization_slug_idx").using("btree", table.slug.asc().nullsLast().op("text_ops")),
    uniqueIndex("Organization_slug_key").using("btree", table.slug.asc().nullsLast().op("text_ops")),
  ],
);

export const user = pgTable(
  "User",
  {
    id: text().primaryKey().notNull().$defaultFn(() => createId()),
    email: text().notNull(),
    emailVerified: boolean().default(false).notNull(),
    name: text().notNull(),
    image: text(),
    username: text(),
    displayUsername: text(),
    displayName: text(),
    createdAt: timestamp({ mode: "string", precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp({ mode: "string", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
  },
  (table) => [
    index("User_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
    uniqueIndex("User_email_key").using("btree", table.email.asc().nullsLast().op("text_ops")),
    uniqueIndex("User_username_key").using("btree", table.username.asc().nullsLast().op("text_ops")),
  ],
);

export const session = pgTable(
  "Session",
  {
    id: text().primaryKey().notNull().$defaultFn(() => createId()),
    userId: text().notNull(),
    expiresAt: timestamp({ mode: "string", precision: 3 }).notNull(),
    token: text().notNull(),
    ipAddress: text(),
    userAgent: text(),
    impersonatedBy: text(),
    createdAt: timestamp({ mode: "string", precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp({ mode: "string", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
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
    id: text().primaryKey().notNull().$defaultFn(() => createId()),
    userId: text().notNull(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ mode: "string", precision: 3 }),
    refreshTokenExpiresAt: timestamp({ mode: "string", precision: 3 }),
    scope: text(),
    password: text(),
    createdAt: timestamp({ mode: "string", precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp({ mode: "string", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
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
    id: text().primaryKey().notNull().$defaultFn(() => createId()),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ mode: "string", precision: 3 }).notNull(),
    createdAt: timestamp({ mode: "string", precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp({ mode: "string", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
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
    id: text().primaryKey().notNull().$defaultFn(() => createId()),
    key: text().notNull(),
    count: integer().notNull(),
    lastRequest: bigint({ mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("RateLimit_key_key").using("btree", table.key.asc().nullsLast().op("text_ops")),
  ],
);

export const orgMembership = pgTable(
  "OrgMembership",
  {
    id: text().primaryKey().notNull().$defaultFn(() => createId()),
    userId: text().notNull(),
    orgId: text().notNull(),
    role: orgRole().notNull(),
    createdAt: timestamp({ mode: "string", precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp({ mode: "string", precision: 3 })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
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
