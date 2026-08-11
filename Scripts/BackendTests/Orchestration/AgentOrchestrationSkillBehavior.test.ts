import path from "node:path";
import { describe, expect, test } from "vitest";
import { listDefaultAgentHostCapabilityNames } from "../../../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentSkillActivationService } from "../../../Source/AgentSystem/Skills/AgentSkillActivation.js";
import { AgentSystemExtensionCatalog } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolSource.js";
import { createAgentSystemTools } from "../../../Source/AgentSystem/SystemTools/AgentSystemTools.js";
import { systemToolCapability } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolCatalog.js";

describe("agent orchestration Skill", () => {
  test("activates for independent child work and recommends the controlled parent tools", async () => {
    const registry = registerSystemExtensions();
    const activated = await new AgentSkillActivationService(registry).activate({
      input: "把大型代码库的后端架构、并发安全和持久化风险拆给多个独立子代理并行审查，最后统一汇总。",
    });

    expect(activated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "agent-orchestration",
          recommendedTools: ["AgentSpawn", "AgentWait", "AgentInput", "AgentStop", "AgentResume"],
        }),
      ]),
    );
  });

  test("does not force delegation for a direct single-step request", async () => {
    const registry = registerSystemExtensions();
    const activated = await new AgentSkillActivationService(registry).activate({
      input: "读取 package.json 里的版本号。",
    });

    expect(activated.map((skill) => skill.name)).not.toContain("agent-orchestration");
  });
});

function registerSystemExtensions(): AgentExtensionRegistry {
  const registry = new AgentExtensionRegistry();
  const definitions = createAgentSystemTools({ ModelProviders: [] });
  new AgentSystemExtensionCatalog().registerRoot(registry, path.resolve("System", "Extensions"), {
    capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]),
  });
  return registry;
}
