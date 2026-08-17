import { describe, expect, it } from "vitest";

import { resolvePolicy } from "#/db/policy";

describe("resolvePolicy", () => {
  it("returns the template's policy when the action type is pinned", () => {
    const tpl = {
      defaultPolicies: { publish_post: "require_approval", worker_deliverable: "auto_execute" },
    };
    expect(resolvePolicy("worker_deliverable", tpl)).toBe("auto_execute");
    expect(resolvePolicy("publish_post", tpl)).toBe("require_approval");
  });

  it("defaults unknown action types to require-approval", () => {
    const tpl = { defaultPolicies: {} };
    expect(resolvePolicy("anything-new", tpl)).toBe("require_approval");
  });

  it("falls back to require-approval when the template policy is malformed", () => {
    const tpl = { defaultPolicies: { worker_deliverable: "no-such-policy" } };
    expect(resolvePolicy("worker_deliverable", tpl)).toBe("require_approval");
  });

  it("accepts notify-only", () => {
    const tpl = { defaultPolicies: { audit_log: "notify_only" } };
    expect(resolvePolicy("audit_log", tpl)).toBe("notify_only");
  });
});
