class TeamMemberNotFoundError extends Error {
  constructor(agentInstanceId: string, companyId: string) {
    super(`agent_instance ${agentInstanceId} not in company ${companyId}`);
    this.name = "TeamMemberNotFoundError";
  }
}

class TeamMemberNotPausableError extends Error {
  constructor(role: string) {
    super(`cannot pause/resume a ${role}`);
    this.name = "TeamMemberNotPausableError";
  }
}

class TemplateNotFoundError extends Error {
  constructor(templateId: string) {
    super(`template ${templateId} not found`);
    this.name = "TemplateNotFoundError";
  }
}

class TemplateRetiredError extends Error {
  constructor(templateId: string) {
    super(`template ${templateId} is retired`);
    this.name = "TemplateRetiredError";
  }
}

class CorrespondentMissingError extends Error {
  constructor(companyId: string) {
    super(`correspondent team_member missing for ${companyId}`);
    this.name = "CorrespondentMissingError";
  }
}

export {
  CorrespondentMissingError,
  TeamMemberNotFoundError,
  TeamMemberNotPausableError,
  TemplateNotFoundError,
  TemplateRetiredError,
};
