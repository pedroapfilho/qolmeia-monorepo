import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ActivityRow as ActivityRowType } from "@/lib/api-types";

import { ActivityRow } from "./activity-row";

const baseRow: ActivityRowType = {
  actorId: null,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  id: "row-1",
  orgId: "org-1",
  payload: null,
  refId: null,
  refType: "NONE",
  summary: "Agente Atendimento iniciou uma execução",
  type: "AGENT_RUN_STARTED",
};

describe("ActivityRow", () => {
  it("renders the summary and type pill", () => {
    render(
      <ul>
        <ActivityRow row={baseRow} />
      </ul>,
    );
    expect(screen.getByText(baseRow.summary)).toBeInTheDocument();
    expect(screen.getByText("AGENT_RUN_STARTED")).toBeInTheDocument();
  });

  it("hides the payload details when payload is empty", () => {
    render(
      <ul>
        <ActivityRow row={baseRow} />
      </ul>,
    );
    expect(screen.queryByText("payload")).not.toBeInTheDocument();
  });

  it("shows a collapsible payload section when payload has data", () => {
    render(
      <ul>
        <ActivityRow row={{ ...baseRow, payload: { length: 12 } }} />
      </ul>,
    );
    expect(screen.getByText("payload")).toBeInTheDocument();
  });
});
