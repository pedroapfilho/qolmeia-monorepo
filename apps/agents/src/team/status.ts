import type { AgentDisplayStatus, OpenTicketSlim } from "@repo/worker-api/contracts";

type InstanceStatus = "active" | "paused";

const resolveAgentStatus = (
  instance: { status: InstanceStatus },
  openTickets: ReadonlyArray<OpenTicketSlim>,
): AgentDisplayStatus => {
  if (instance.status === "paused") {
    return "paused";
  }
  if (openTickets.some((t) => t.status === "in_progress")) {
    return "working";
  }
  if (openTickets.some((t) => t.status === "awaiting_approval")) {
    return "awaiting_approval";
  }
  return "available";
};

export { resolveAgentStatus };
