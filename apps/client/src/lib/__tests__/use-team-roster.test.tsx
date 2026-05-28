import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamMemberView } from "@/lib/team";
import { useTeamRoster } from "@/lib/use-team-roster";

const mockFetchTeam = vi.fn();
const mockUseAgent = vi.fn();

vi.mock("agents/react", () => ({
  useAgent: (opts: unknown) => mockUseAgent(opts),
}));

vi.mock("@/lib/team", async () => {
  const actual = (await vi.importActual("@/lib/team")) as {
    fetchTeam: () => Promise<Array<TeamMemberView>>;
  };
  return {
    ...actual,
    fetchTeam: () => mockFetchTeam(),
  };
});

beforeEach(() => {
  mockUseAgent.mockReset();
  mockFetchTeam.mockReset();
  mockFetchTeam.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useTeamRoster", () => {
  it("fetches on mount", async () => {
    const { result } = renderHook(() => useTeamRoster("co1", "tok"));

    // Wait for the initial fetch to complete and status to be ready
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    expect(mockFetchTeam).toHaveBeenCalledOnce();
    expect(result.current.members).toEqual([]);
  });

  it("invalidates on a team:* frame and skips non-team frames", async () => {
    let capturedOnMessage: ((event: { data: string }) => void) | null = null;
    mockUseAgent.mockImplementation((opts: { onMessage: typeof capturedOnMessage }) => {
      capturedOnMessage = opts.onMessage;
    });

    renderHook(() => useTeamRoster("co1", "tok"));

    await vi.waitFor(() => expect(mockFetchTeam).toHaveBeenCalledOnce());

    // Trigger team:roster frame
    act(() => {
      capturedOnMessage?.({
        data: JSON.stringify({ companyId: "co1", reason: "hired", type: "team:roster" }),
      });
    });

    await vi.waitFor(() => expect(mockFetchTeam).toHaveBeenCalledTimes(2));

    // Non-team frame should NOT trigger refetch
    act(() => {
      capturedOnMessage?.({ data: JSON.stringify({ id: "abc", type: "chat:message" }) });
    });

    // Give it a tick to ensure no refetch happened
    await vi.waitFor(() => expect(mockFetchTeam).toHaveBeenCalledTimes(2));

    // Malformed JSON should not crash
    act(() => {
      capturedOnMessage?.({ data: "not json" });
    });

    expect(mockFetchTeam).toHaveBeenCalledTimes(2); // unchanged, no throw
  });

  it("sets up polling and message handlers via useAgent", async () => {
    renderHook(() => useTeamRoster("co1", "tok"));

    await vi.waitFor(() => expect(mockUseAgent).toHaveBeenCalled());

    const callArgs = mockUseAgent.mock.calls[0][0];

    // Verify the expected hooks are wired
    expect(callArgs).toMatchObject({
      agent: "correspondent",
      name: "co1",
      query: { cf_session: "tok" },
    });

    // Verify onMessage exists and is a function
    expect(typeof callArgs.onMessage).toBe("function");
    expect(typeof callArgs.onOpen).toBe("function");
    expect(typeof callArgs.onClose).toBe("function");
  });

  it("refetches on visibility change to visible", async () => {
    const { result } = renderHook(() => useTeamRoster("co1", "tok"));

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    // Simulate becoming visible
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.waitFor(() => expect(mockFetchTeam).toHaveBeenCalledTimes(2));
  });

  it("exposes refetch method for manual triggers", async () => {
    const { result } = renderHook(() => useTeamRoster("co1", "tok"));

    await vi.waitFor(() => expect(mockFetchTeam).toHaveBeenCalledOnce());

    act(() => {
      result.current.refetch();
    });

    await vi.waitFor(() => expect(mockFetchTeam).toHaveBeenCalledTimes(2));
  });

  it("handles fetch errors and exposes error state", async () => {
    const testError = new Error("Network failed");
    mockFetchTeam.mockRejectedValueOnce(testError);

    const { result } = renderHook(() => useTeamRoster("co1", "tok"));

    await vi.waitFor(() => expect(result.current.status).toBe("error"));

    expect(result.current.error).toEqual(testError);
    expect(result.current.members).toEqual([]);
  });
});
