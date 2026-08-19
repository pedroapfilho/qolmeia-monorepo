/**
 * Agent and team row ids are derived, not stored: apps/api writes them and the
 * Worker addresses Durable Objects by the same strings. Both sides must derive
 * them identically, so the derivations live here rather than in either app.
 */

const correspondentIdFor = (companyId: string): string => `corr-${companyId}`;

const plannerIdFor = (companyId: string): string => `planner-${companyId}`;

const teamIdFor = (companyId: string): string => `team-${companyId}`;

const workerIdFor = (templateId: string, companyId: string): string =>
  `worker-${templateId}-${companyId}`;

export { correspondentIdFor, plannerIdFor, teamIdFor, workerIdFor };
