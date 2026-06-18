# Operators are platform-wide Qolmeia staff, not per-company members

The codebase contradicted itself on what an **Operator** is. The dev seed puts the `OWNER` and the `CUSTOMER` in the _same_ `company`, and every backoffice route gates on `companyId === session.companyId` — a per-company reading. But the product's differentiator is a human quality layer: Qolmeia professionals who vet AI prompts and results across _all_ customer companies. Those can't both be true.

**Decision:** an Operator is **Qolmeia platform staff, cross-tenant**. A Company is a customer tenant only.

- **Identity.** Operators are the `OWNER`/`STAFF` members of a single internal **"Qolmeia" org**. They are not members of any customer Company. Customer Companies are untouched; a Company still has many **Accounts** (the `CUSTOMER` users who use its surface).
- **Authorization.** The backoffice authorizes on the **role** (`OWNER`/`STAFF`), never on company membership. The `companyId` in a backoffice URL is "the company being acted on" — validated to _exist_, never required to equal the session. This means the current `if (companyId !== session.companyId) return 403` checks in `apps/agents/src/routes/backoffice.ts` are wrong under this model and must become role checks. `GET /api/backoffice/companies` (returns every company) already assumes this.
- **Customer isolation is unchanged.** ADR&nbsp;0001's tenant isolation still holds, but it is now scoped to the **customer surface**: the `/agents/<name>/<companyId>` paths and `/api/me/*` remain authorized by `companyId === session.companyId`, because a Customer belongs to exactly one Company.

## Routing (forward-looking — schema seam now, simple default)

The quality layer is a triage problem: the AI Designer's output should reach Qolmeia's _human_ designer, copy to a copy reviewer, etc.

- Each **Action** carries a **discipline** derived from its producing agent's `worker_kind` (designer → `design`, redator → `copy`, …). The agent is already joined onto every Action, so the discipline falls out of the data — no separate tagging surface (chosen over a standalone tag system; that can layer on later).
- An **Operator** has an optional set of **assigned Companies** and an optional set of **disciplines**. The approval queue filters to `company ∈ assignment` (or unassigned) **and** `discipline ∈ operator disciplines` (or none).
- **Default for now:** an Operator with no assignment and no discipline set sees everything. Assignment/discipline narrowing is built when there are operators to narrow.

## Consequences

- Backoffice route authorization must be reworked from `companyId`-match to role-based (a follow-up; not yet implemented).
- The operator's session no longer meaningfully carries a customer `companyId`; backoffice handlers take the target company from the URL.
- The dev seed (operator inside the customer company) is a shortcut, not the model; a faithful seed would create the internal Qolmeia org separately.
