import { describe, expect, test } from "vitest";
import { projectEffectiveConfig } from "../../../Source/AgentSystem/Config/AgentConfigEffectiveProjector.js";
import { projectAgentConfigForm } from "../../../Source/AgentSystem/Config/AgentConfigFormProjector.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("sandbox default projection", () => {
  test("enables sandbox execution by default in runtime and form projections", () => {
    const config: AgentSystemConfig = { ModelProviders: [] };
    expect(projectEffectiveConfig(config).SandboxRuntime?.Enabled).toBe(true);
    const field = projectAgentConfigForm(config)
      .sections.flatMap((section) => section.fields)
      .find((candidate) => candidate.path.join(".") === "SandboxRuntime.Enabled");
    expect(field).toMatchObject({ effectiveValue: true, valueSource: "default", configured: false });
  });

  test("preserves an explicit sandbox opt-out", () => {
    const config: AgentSystemConfig = { ModelProviders: [], SandboxRuntime: { Enabled: false } };
    expect(projectEffectiveConfig(config).SandboxRuntime?.Enabled).toBe(false);
  });
});
