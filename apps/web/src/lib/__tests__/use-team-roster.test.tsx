import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamMemberView } from "@/lib/team";
import { createUseTeamRoster } from "@/lib/use-team-roster";

const mockFetchTeam = vi.fn();
const mockSubscribeTeamEvents = vi.fn();
const useTeamRoster = createUseTeamRoster({
  fetchRoster: mockFetchTeam,
  subscribeToTeamEvents: mockSubscribeTeamEvents,
});

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

const renderRoster = () => renderHook(() => useTeamRoster("co1"), { wrapper: createWrapper() });

const initialMember: TeamMemberView = {
  currentWork: [],
  displayName: "Planejador",
  hasPromptOverride: false,
  id: "planner-co1",
  lifetimeDone: 0,
  role: "planner",
  status: "available",
  templateId: null,
  workerKind: null,
};

beforeEach(() => {
  mockFetchTeam.mockReset();
  mockFetchTeam.mockResolvedValue([]);
  mockSubscribeTeamEvents.mockReset();
  mockSubscribeTeamEvents.mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useTeamRoster", () => {
  it("fetches on mount", async () => {
    const { result } = renderRoster();

    await vi.waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(mockFetchTeam).toHaveBeenCalledOnce();
    expect(result.current.members).toEqual([]);
  });

  it("uses server initial data without refetching on mount", () => {
    const { result } = renderHook(() => useTeamRoster("co1", [initialMember]), {
      wrapper: createWrapper(),
    });

    expect(result.current.members).toEqual([initialMember]);
    expect(result.current.status).toBe("ready");
    expect(mockFetchTeam).not.toHaveBeenCalled();
  });

  it("refetches on visibility change to visible", async () => {
    const { result } = renderRoster();

    await vi.waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      window.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.waitFor(() => {
      expect(mockFetchTeam).toHaveBeenCalledTimes(2);
    });
  });

  it("exposes refetch method for manual triggers", async () => {
    const { result } = renderRoster();

    await vi.waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(mockFetchTeam).toHaveBeenCalledOnce();

    act(() => {
      void result.current.refetch();
    });

    await vi.waitFor(() => {
      expect(mockFetchTeam).toHaveBeenCalledTimes(2);
    });
  });

  it("refetches when a team event arrives", async () => {
    let notify: (() => void) | undefined;
    mockSubscribeTeamEvents.mockImplementation((onEvent: () => void) => {
      notify = onEvent;
      return null;
    });

    const { result } = renderRoster();

    await vi.waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(mockFetchTeam).toHaveBeenCalledOnce();

    act(() => {
      notify?.();
    });

    await vi.waitFor(() => {
      expect(mockFetchTeam).toHaveBeenCalledTimes(2);
    });
  });

  it("unsubscribes from team events on unmount", async () => {
    const unsubscribe = vi.fn();
    mockSubscribeTeamEvents.mockReturnValue(unsubscribe);

    const { result, unmount } = renderRoster();
    await vi.waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("handles fetch errors and exposes error state", async () => {
    const testError = new Error("Network failed");
    mockFetchTeam.mockRejectedValueOnce(testError);

    const { result } = renderRoster();

    await vi.waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    expect(result.current.error).toEqual(testError);
    expect(result.current.members).toEqual([]);
  });
});
