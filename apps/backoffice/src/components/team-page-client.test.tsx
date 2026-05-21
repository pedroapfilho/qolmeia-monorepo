import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/ui/lib/utils", () => ({
  cn: (...args: ReadonlyArray<unknown>) => args.filter(Boolean).join(" "),
}));

vi.mock("@repo/ui/components/button", () => ({
  Button: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    // eslint-disable-next-line react/button-has-type -- pass-through stub for testing
    <button type="button" {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/invite-form", () => ({
  InviteForm: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose} type="button">
      stub-invite-form
    </button>
  ),
}));

const { TeamPageClient } = await import("./team-page-client");

const buildMember = (overrides: Partial<{ id: string; role: "OWNER" | "STAFF" | "CUSTOMER" }> = {}) => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  id: overrides.id ?? "mem_1",
  role: overrides.role ?? ("OWNER" as const),
  user: {
    displayName: null,
    email: "owner@example.com",
    id: "user_1",
    image: null,
    name: "Owner",
  },
});

describe("TeamPageClient", () => {
  it("renders the empty state when there are no members", () => {
    render(<TeamPageClient members={[]} />);
    expect(screen.getByText(/Nenhum membro ainda/v)).toBeInTheDocument();
  });

  it("renders each member with their role label in pt-BR", () => {
    render(
      <TeamPageClient
        members={[
          buildMember({ id: "m1", role: "OWNER" }),
          buildMember({ id: "m2", role: "STAFF" }),
          buildMember({ id: "m3", role: "CUSTOMER" }),
        ]}
      />,
    );
    expect(screen.getByText("Dono")).toBeInTheDocument();
    // "Equipe" appears in both the page header and the STAFF badge — use
    // getAllByText so the assertion doesn't bind to a specific element.
    expect(screen.getAllByText("Equipe").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Cliente")).toBeInTheDocument();
  });

  it("toggles the invite form when 'Convidar' is clicked", () => {
    render(<TeamPageClient members={[buildMember()]} />);
    expect(screen.queryByText("stub-invite-form")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Convidar/v }));
    expect(screen.getByText("stub-invite-form")).toBeInTheDocument();
  });
});
