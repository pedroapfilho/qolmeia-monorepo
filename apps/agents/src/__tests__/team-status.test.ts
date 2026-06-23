import { describe, expect, it } from "vitest";

import { resolveAgentStatus } from "#/team/status";

describe("resolveAgentStatus", () => {
  it("returns paused when instance is paused regardless of tickets", () => {
    expect(
      resolveAgentStatus({ status: "paused" }, [
        { status: "in_progress", summary: "x", ticketId: "t1" },
      ]),
    ).toBe("paused");
  });

  it("returns working when any ticket is in_progress", () => {
    expect(
      resolveAgentStatus({ status: "active" }, [
        { status: "in_progress", summary: "x", ticketId: "t1" },
      ]),
    ).toBe("working");
  });

  it("returns awaiting_approval when only awaiting_approval tickets exist", () => {
    expect(
      resolveAgentStatus({ status: "active" }, [
        { status: "awaiting_approval", summary: "x", ticketId: "t1" },
      ]),
    ).toBe("awaiting_approval");
  });

  it("returns working when both in_progress and awaiting_approval exist (in_progress dominates)", () => {
    expect(
      resolveAgentStatus({ status: "active" }, [
        { status: "awaiting_approval", summary: "x", ticketId: "t1" },
        { status: "in_progress", summary: "y", ticketId: "t2" },
      ]),
    ).toBe("working");
  });

  it("returns available when no open tickets", () => {
    expect(resolveAgentStatus({ status: "active" }, [])).toBe("available");
  });
});
