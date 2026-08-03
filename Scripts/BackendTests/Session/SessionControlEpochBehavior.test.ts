import { describe, expect, test } from "vitest";
import { AgentSessionControlEpoch } from "../../../Source/AgentSystem/Session/AgentSessionControlEpoch.js";

describe("Session control epoch behavior", () => {
  test("retirement cannot revive or clear a newer token", () => {
    const epoch = new AgentSessionControlEpoch();
    const first = epoch.issue("session-a");
    epoch.invalidate("session-a");
    const second = epoch.issue("session-a");

    expect(epoch.isCurrent(first)).toBe(false);
    expect(epoch.isCurrent(second)).toBe(true);
    epoch.retire(first);
    expect(epoch.isCurrent(second)).toBe(true);
    epoch.retire(second);
    expect(epoch.isCurrent(second)).toBe(false);
  });
});
