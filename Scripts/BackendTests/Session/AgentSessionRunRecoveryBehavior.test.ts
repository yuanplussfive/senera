import { describe, expect, test } from "vitest";
import {
  AgentSessionContinuationInput,
  AgentSessionRecoveryModes,
} from "../../../Source/AgentSystem/Session/AgentSessionRunRecovery.js";

describe("agent session run recovery", () => {
  test("keeps recovery modes explicit instead of inferring them from run progress", () => {
    expect(AgentSessionRecoveryModes).toEqual({ Retry: "retry", Continue: "continue" });
    expect(AgentSessionContinuationInput).toBe("continue");
  });
});
