import { relations } from "drizzle-orm/relations";

import { account, orgMembership, organization, session, user } from "./schema";

export const organizationRelations = relations(organization, ({ many }) => ({
  memberships: many(orgMembership),
}));

export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  memberships: many(orgMembership),
  sessions: many(session),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const orgMembershipRelations = relations(orgMembership, ({ one }) => ({
  org: one(organization, { fields: [orgMembership.orgId], references: [organization.id] }),
  user: one(user, { fields: [orgMembership.userId], references: [user.id] }),
}));
