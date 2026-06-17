# Qolmeia

An AI marketing agency: each customer company gets a Team of AI agents that does marketing work, with human operators approving sensitive actions before they ship.

## Language

### Actors

**Company**:
A customer tenant. Its id (`companyId`) is the unit of isolation. It is also the Durable Object instance id every agent is keyed by, so a request's `companyId` is always authorized against the session, never trusted from the URL.
_Avoid_: org, account, tenant, client

**Customer**:
An end-user who belongs to a Company and chats with its agents (the `CUSTOMER` role).
_Avoid_: user, end user

**Operator**:
A Qolmeia staff member who reviews and decides Actions in the backoffice (`OWNER`/`STAFF` roles). Operators never open an agent connection; they act through REST.
_Avoid_: admin, moderator

### Agents

**Correspondent**:
The single point of contact for a Company, one per Company. Talks to the Customer, delegates specialist work, and presents finished deliverables back in chat.
_Avoid_: assistant, bot, concierge

**Planner**:
The onboarding-interview agent that runs before a Team exists: it debriefs the Company and proposes a Team.
_Avoid_: onboarder, setup agent

**Worker**:
A specialist agent instantiated from a Template (e.g. Designer, Marketing Strategist) that produces a specific kind of deliverable.
_Avoid_: specialist bot, sub-agent

**Team**:
The confirmed set of agents (one Correspondent + its Workers) for a Company. Materialized when the Customer confirms during onboarding.

### Work

**Brief**:
The structured profile of a Company's business: industry, primary goal, audience, channels, and brand (voice, palette, references). Drives what the agents produce; "complete" means all of those are filled.
_Avoid_: profile, questionnaire

**Ticket**:
A unit of delegated work the Correspondent hands to a Worker; tracked through `in_progress` → `awaiting_approval` → `done`.
_Avoid_: task, job

**Action**:
A proposed side-effect a Worker wants to take (e.g. publish a post) that an Operator must approve before it executes. Distinct from a Ticket: the Ticket is the work, the Action is the gated effect.
_Avoid_: approval, request
