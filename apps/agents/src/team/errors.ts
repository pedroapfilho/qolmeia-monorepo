type TeamErrorCode =
  | "correspondent_missing"
  | "member_not_found"
  | "member_not_pausable"
  | "template_not_found"
  | "template_retired";

/**
 * `message` is the internal detail (ids, roles) and goes to logs; `publicMessage`
 * is what a route may hand back to a caller. They differ only where the detail
 * would leak another tenant's identifiers.
 */
abstract class TeamDomainError extends Error {
  abstract readonly code: TeamErrorCode;

  get publicMessage(): string {
    return this.message;
  }
}

class TeamMemberNotFoundError extends TeamDomainError {
  readonly code = "member_not_found";

  constructor(agentInstanceId: string, companyId: string) {
    super(`agent_instance ${agentInstanceId} not in company ${companyId}`);
    this.name = "TeamMemberNotFoundError";
  }

  override get publicMessage(): string {
    return "not found";
  }
}

class TeamMemberNotPausableError extends TeamDomainError {
  readonly code = "member_not_pausable";

  constructor(role: string) {
    super(`cannot pause/resume a ${role}`);
    this.name = "TeamMemberNotPausableError";
  }
}

class TemplateNotFoundError extends TeamDomainError {
  readonly code = "template_not_found";

  constructor(templateId: string) {
    super(`template ${templateId} not found`);
    this.name = "TemplateNotFoundError";
  }
}

class TemplateRetiredError extends TeamDomainError {
  readonly code = "template_retired";

  constructor(templateId: string) {
    super(`template ${templateId} is retired`);
    this.name = "TemplateRetiredError";
  }
}

class CorrespondentMissingError extends TeamDomainError {
  readonly code = "correspondent_missing";

  constructor(companyId: string) {
    super(`correspondent team_member missing for ${companyId}`);
    this.name = "CorrespondentMissingError";
  }
}

/**
 * One table so the customer and operator surfaces cannot answer differently for
 * the same domain error, which they previously did (400 vs 409, and 404 vs 500).
 */
const TEAM_ERROR_STATUS = {
  correspondent_missing: 500,
  member_not_found: 404,
  member_not_pausable: 409,
  template_not_found: 404,
  template_retired: 409,
} satisfies Record<TeamErrorCode, 404 | 409 | 500>;

export {
  CorrespondentMissingError,
  TEAM_ERROR_STATUS,
  TeamDomainError,
  TeamMemberNotFoundError,
  TeamMemberNotPausableError,
  TemplateNotFoundError,
  TemplateRetiredError,
};
export type { TeamErrorCode };
