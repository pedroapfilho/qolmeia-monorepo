// Typed activity event surface. Adding a new event type = a new branch in
// `ActivityEvent` below.
//
// What's load-bearing: the `(type, refType, payload-shape)` triplet. The
// `summary` field is free-form pt-BR text per call. `refId` carries the id
// of whatever the event refers to (action id, ticket id, team id, …) but
// its type doesn't constrain the value beyond `string`.
//
// New events get a code prefix that matches one of the backoffice categories
// so the prefix-based fallback (apps/backoffice/.../activity-row) keeps
// working for any rows written by older versions of the worker.

type ActionProposedEvent = {
  payload: { actionId: string; summary: string };
  refId: string;
  refType: "action";
  type: "ACTION_PROPOSED";
};

type ActionExecutedEvent = {
  payload?: undefined;
  refId: string;
  refType: "action";
  type: "ACTION_EXECUTED";
};

type ActionRejectedEvent = {
  payload: { feedback: string | null };
  refId: string;
  refType: "action";
  type: "ACTION_REJECTED";
};

type ActionChangesRequestedEvent = {
  payload: { feedback: string | null };
  refId: string;
  refType: "action";
  type: "ACTION_CHANGES_REQUESTED";
};

// The Worker regenerated after a request-changes decision (the revise loop).
// refId is the *new* action id proposed for the revised deliverable.
type ActionRevisedEvent = {
  payload: { feedback: string | null; revision: number };
  refId: string;
  refType: "action";
  type: "ACTION_REVISED";
};

// The revise loop hit its soft cap — the Worker stops regenerating; the
// operator approves or rejects the last version. refId is the action id.
type ActionRevisionCappedEvent = {
  payload: { revisions: number };
  refId: string;
  refType: "action";
  type: "ACTION_REVISION_CAPPED";
};

// notify-only policy: the action ran immediately (no gate) but is surfaced to
// the operator monitoring feed for after-the-fact spot-check. refId is the
// ticket id (notify-only mints no blocking action row).
type ActionNotifyEvent = {
  payload: { summary: string };
  refId: string;
  refType: "ticket";
  type: "ACTION_NOTIFY";
};

type TicketDoneEvent = {
  payload?: undefined;
  refId: string;
  refType: "ticket";
  type: "TICKET_DONE";
};

type TeamConfirmedEvent = {
  payload: {
    teamId: string;
    templateIds: ReadonlyArray<string>;
    workerInstanceIds?: ReadonlyArray<string>;
  };
  refId: string;
  refType: "team";
  type: "TEAM_CONFIRMED";
};

type MemberHiredEvent = {
  payload: { displayName: string; templateId: string };
  refId: string;
  refType: "agent_instance";
  type: "MEMBER_HIRED";
};

type MemberPausedEvent = {
  payload?: undefined;
  refId: string;
  refType: "agent_instance";
  type: "MEMBER_PAUSED";
};

type MemberResumedEvent = {
  payload?: undefined;
  refId: string;
  refType: "agent_instance";
  type: "MEMBER_RESUMED";
};

type MemberRenamedEvent = {
  payload: { newName: string; oldName: string };
  refId: string;
  refType: "agent_instance";
  type: "MEMBER_RENAMED";
};

type MemberPromptEditedEvent = {
  payload: { editedBy: "customer" | "operator"; length: number | null };
  refId: string;
  refType: "agent_instance";
  type: "MEMBER_PROMPT_EDITED";
};

type MemberPromptResetEvent = {
  payload: { editedBy: "customer" | "operator" };
  refId: string;
  refType: "agent_instance";
  type: "MEMBER_PROMPT_RESET";
};

// Agent-initiated proactive outreach (the weekly "suggest next work" sweep).
// WORKER_ prefix so the backoffice prefix-based categoriser buckets it with
// other agent-work events. refId is the Correspondent agent_instance id.
type WorkerProactiveSuggestionEvent = {
  payload?: undefined;
  refId: string;
  refType: "agent_instance";
  type: "WORKER_PROACTIVE_SUGGESTION";
};

type ActivityEvent =
  | ActionProposedEvent
  | ActionExecutedEvent
  | ActionRejectedEvent
  | ActionChangesRequestedEvent
  | ActionRevisedEvent
  | ActionRevisionCappedEvent
  | ActionNotifyEvent
  | TicketDoneEvent
  | TeamConfirmedEvent
  | MemberHiredEvent
  | MemberPausedEvent
  | MemberResumedEvent
  | MemberRenamedEvent
  | MemberPromptEditedEvent
  | MemberPromptResetEvent
  | WorkerProactiveSuggestionEvent;

type ActivityType = ActivityEvent["type"];

export type { ActivityEvent, ActivityType };
