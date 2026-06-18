import { describe, expect, it } from "vitest";

import { buildRevisionMessages, MAX_REVISIONS } from "@/workflows/worker-job";

// The revise loop's prompt construction (ADR 0006). The full Workflow run() —
// generate → propose → waitForEvent → decide, looping on request-changes — is
// exercised end-to-end against the live runtime; here we pin the pure piece:
// how operator feedback is replayed into the next generation.

describe("buildRevisionMessages", () => {
  it("first round is just the brief", () => {
    const messages = buildRevisionMessages("Crie 3 posts de lançamento", null, null);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ content: "Crie 3 posts de lançamento", role: "user" });
  });

  it("a revision replays the prior deliverable + the operator's note", () => {
    const messages = buildRevisionMessages(
      "Crie 3 posts de lançamento",
      "Aqui estão 3 posts...",
      "Deixe o tom mais informal e cite o preço.",
    );
    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]).toEqual({ content: "Aqui estão 3 posts...", role: "assistant" });
    expect(messages[2]?.role).toBe("user");
    expect(messages[2]?.content).toContain("mais informal");
    expect(messages[2]?.content).toContain("Refaça");
  });

  it("missing feedback falls back to a fresh brief (no dangling assistant turn)", () => {
    const messages = buildRevisionMessages("Brief", "prior", null);
    expect(messages).toHaveLength(1);
  });

  it("exposes a small, positive soft cap", () => {
    expect(MAX_REVISIONS).toBeGreaterThan(0);
    expect(MAX_REVISIONS).toBeLessThanOrEqual(5);
  });
});
