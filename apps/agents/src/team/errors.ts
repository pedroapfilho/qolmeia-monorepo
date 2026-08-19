type TeamErrorCode =
  | "correspondent_missing"
  | "member_not_found"
  | "member_not_pausable"
  | "template_not_found"
  | "template_retired";

const isTeamErrorCode = (value: string): value is TeamErrorCode =>
  value === "correspondent_missing" ||
  value === "member_not_found" ||
  value === "member_not_pausable" ||
  value === "template_not_found" ||
  value === "template_retired";

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

class RemoteTeamDomainError extends TeamDomainError {
  readonly code: TeamErrorCode;

  constructor(code: string, message: string) {
    super(message);
    if (!isTeamErrorCode(code)) {
      throw new Error(`Unknown team error code: ${code}`);
    }
    this.code = code;
    this.name = "RemoteTeamDomainError";
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

export { RemoteTeamDomainError, TEAM_ERROR_STATUS, TeamDomainError };
export type { TeamErrorCode };
