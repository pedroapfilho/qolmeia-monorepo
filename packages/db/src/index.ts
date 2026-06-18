export * from "./client";
export * from "./relations";
export * from "./schema";

import type * as schema from "./schema";

export type Organization = typeof schema.organization.$inferSelect;
export type User = typeof schema.user.$inferSelect;
export type Session = typeof schema.session.$inferSelect;
export type Account = typeof schema.account.$inferSelect;
export type Verification = typeof schema.verification.$inferSelect;
export type RateLimit = typeof schema.rateLimit.$inferSelect;
export type OrgMembership = typeof schema.orgMembership.$inferSelect;
