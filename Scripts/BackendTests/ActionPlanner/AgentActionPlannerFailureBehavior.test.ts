import { describe, expect, test } from "vitest";
import { z } from "zod";
import { AgentStructuredOutputValidationError } from "../../../Source/AgentSystem/Diagnostics/AgentStructuredOutputValidationError.js";
import { stringifyIssueValue } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerFailure.js";

describe("action planner repair value projection", () => {
  test("keeps structured invalid output compact and canonically ordered", () => {
    const error = new AgentStructuredOutputValidationError(["invalid decision"], { z: 3, a: 1 });

    expect(stringifyIssueValue(error)).toBe('{"a":1,"z":3}');
    expect(stringifyIssueValue(error)).not.toContain("\n");
  });

  test("keeps validation issues compact", () => {
    const error = new z.ZodError([{ code: "custom", path: ["decision"], message: "invalid" }]);

    expect(stringifyIssueValue(error)).toBe('[{"code":"custom","message":"invalid","path":["decision"]}]');
  });
});
