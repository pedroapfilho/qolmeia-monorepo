// Typed activity event surface.
//
// Adding a new event type: add a new branch to `ActivityEvent` below.
//
// What's load-bearing: the `(type, refType, payload-shape)` triplet. The
// `summary` field is free-form pt-BR text per call. `refId` carries the id
// of whatever the event refers to (action id, ticket id, team id, …) but
// its type doesn't constrain the value beyond `string`.
//
// New events get a code prefix that matches one of the categories so the
// prefix-based categorisation in the backoffice (apps/backoffice/.../
// activity-row) keeps working for any rows written by older versions of
// the worker.

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

type ActivityEvent =
  | ActionProposedEvent
  | ActionExecutedEvent
  | ActionRejectedEvent
  | ActionChangesRequestedEvent
  | TicketDoneEvent
  | TeamConfirmedEvent
  | MemberHiredEvent
  | MemberPausedEvent
  | MemberResumedEvent
  | MemberRenamedEvent
  | MemberPromptEditedEvent
  | MemberPromptResetEvent;

type ActivityType = ActivityEvent["type"];

export type { ActivityEvent, ActivityType };
