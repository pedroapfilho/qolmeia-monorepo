// Typed activity event surface.
//
// Adding a new event type:
//   1. Add a new branch to `ActivityEvent` below.
//   2. Add the type to `ACTIVITY_TYPES` (the runtime constant the backoffice
//      can use to drive a renderer registry).
//   3. Add a case to `eventCategory` — the exhaustive switch will fail at
//      compile time if you forget.
//
// What's load-bearing: the `(type, refType, payload-shape)` triplet. The
// `summary` field is free-form pt-BR text per call. `refId` carries the id
// of whatever the event refers to (action id, ticket id, team id, …) but
// its type doesn't constrain the value beyond `string`.
//
// The backoffice's UI categorises pills by `eventCategory` so the operator
// scans by hue. A typo in the agents-side type would fail at compile time,
// not as a "neutral" pill in production.
//
// New events get a code prefix that matches one of the categories so the
// prefix-based fallback in the backoffice (apps/backoffice/.../activity-row)
// keeps working for any rows written by older versions of the worker.
//
// History tail of categories used so far: action, ticket, team. Future
// extensions: worker (worker lifecycle), member (org membership changes).

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

type ActivityEvent =
  | ActionProposedEvent
  | ActionExecutedEvent
  | ActionRejectedEvent
  | ActionChangesRequestedEvent
  | TicketDoneEvent
  | TeamConfirmedEvent
  | MemberHiredEvent;

type ActivityType = ActivityEvent["type"];

type ActivityCategory = "action" | "member" | "team" | "ticket";

// Discriminated lookup. Adding a new ActivityEvent branch without
// updating this switch fails to compile — the `never` narrowing in
// the `default` is the trap that makes exhaustiveness load-bearing.
const eventCategory = (event: ActivityEvent): ActivityCategory => {
  switch (event.type) {
    case "ACTION_PROPOSED":
    case "ACTION_EXECUTED":
    case "ACTION_REJECTED":
    case "ACTION_CHANGES_REQUESTED": {
      return "action";
    }
    case "TICKET_DONE": {
      return "ticket";
    }
    case "TEAM_CONFIRMED": {
      return "team";
    }
    case "MEMBER_HIRED": {
      return "member";
    }
    default: {
      const unhandled: never = event;
      throw new Error(`unhandled activity event: ${JSON.stringify(unhandled)}`);
    }
  }
};

// Runtime tuple of every legal type literal — exported for tests + future
// renderer registries in the backoffice that want to iterate.
const ACTIVITY_TYPES = [
  "ACTION_PROPOSED",
  "ACTION_EXECUTED",
  "ACTION_REJECTED",
  "ACTION_CHANGES_REQUESTED",
  "TICKET_DONE",
  "TEAM_CONFIRMED",
  "MEMBER_HIRED",
] as const satisfies ReadonlyArray<ActivityType>;

export { ACTIVITY_TYPES, eventCategory };
export type { ActivityCategory, ActivityEvent, ActivityType };
