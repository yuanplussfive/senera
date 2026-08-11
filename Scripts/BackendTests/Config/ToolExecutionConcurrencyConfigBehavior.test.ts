import { describe, expect, test } from "vitest";
import { resolveToolExecutionConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { projectAgentConfigForm } from "../../../Source/AgentSystem/Config/AgentConfigFormProjector.js";
import { AgentSystemConfigSchema } from "../../../Source/AgentSystem/Schemas/AgentSystemConfigSchema.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("tool execution concurrency configuration", () => {
  test("uses the centralized per-run default and honors configuration precedence", () => {
    expect(resolveToolExecutionConfig(config()).MaxConcurrentCallsPerRun).toBe(10);
    const field = projectAgentConfigForm(config())
      .sections.flatMap((section) => section.fields)
      .find((candidate) => candidate.path.join(".") === "ToolExecution.MaxConcurrentCallsPerRun");
    expect(field).toMatchObject({ effectiveValue: 10, valueSource: "default", configured: false });
    expect(
      resolveToolExecutionConfig(
        config({
          Defaults: { ToolExecution: { MaxConcurrentCallsPerRun: 7 } },
          ToolExecution: { MaxConcurrentCallsPerRun: 3 },
        }),
      ).MaxConcurrentCallsPerRun,
    ).toBe(3);
  });

  test("rejects invalid per-run concurrency limits at the configuration boundary", () => {
    const parsed = AgentSystemConfigSchema.safeParse(config({ ToolExecution: { MaxConcurrentCallsPerRun: 0 } }));

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: ["ToolExecution", "MaxConcurrentCallsPerRun"] }),
      );
    }
  });

  test("projects the approval-sensitive semantic audit policy through config and form contracts", () => {
    expect(resolveToolExecutionConfig(config()).SemanticAudit.Mode).toBe("approval_sensitive");
    const field = projectAgentConfigForm(config())
      .sections.flatMap((section) => section.fields)
      .find((candidate) => candidate.path.join(".") === "ToolExecution.SemanticAudit.Mode");
    expect(field).toMatchObject({
      effectiveValue: "approval_sensitive",
      valueSource: "default",
      configured: false,
    });
    expect(
      resolveToolExecutionConfig(config({ ToolExecution: { SemanticAudit: { Mode: "disabled" } } })).SemanticAudit.Mode,
    ).toBe("disabled");
  });
});

function config(overrides: Partial<AgentSystemConfig> = {}): AgentSystemConfig {
  return {
    ModelProviders: [],
    ...overrides,
  };
}
