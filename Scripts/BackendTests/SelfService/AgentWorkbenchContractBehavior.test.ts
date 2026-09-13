import { describe, expect, test } from "vitest";
import { sha256HexOfCanonicalJson } from "../../../Source/AgentSystem/Core/AgentHash.js";
import { AgentSelfPhilosophy } from "../../../Source/AgentSystem/SelfService/AgentSelfPhilosophy.js";
import {
  AgentWorkbenchContract,
  projectAgentWorkbenchContract,
  projectAgentWorkbenchPhilosophy,
  projectAgentWorkbenchRuleIndex,
  renderAgentWorkbenchContractIndex,
} from "../../../Source/AgentSystem/SelfService/AgentWorkbenchContract.js";
import { projectAgentSelfCapabilities } from "../../../Source/AgentSystem/SelfService/AgentSelfCapabilities.js";

describe("senera workbench contract", () => {
  test("has a deterministic revision over the canonical contract body", () => {
    const { revision, ...body } = AgentWorkbenchContract;
    expect(revision).toBe(sha256HexOfCanonicalJson(body));
    expect(projectAgentWorkbenchContract()).toMatchObject({
      id: "senera.workbench",
      version: 1,
      authority: "runtime",
      revision,
    });
  });

  test("projects unique rules and derives self philosophy without a second source", () => {
    const rules = projectAgentWorkbenchRuleIndex();
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length);
    expect(new Set(rules.map((rule) => rule.key)).size).toBe(rules.length);
    expect(projectAgentWorkbenchPhilosophy()).toEqual(AgentSelfPhilosophy);
    expect(rules.every((rule) => rule.enforcedBy.length > 0)).toBe(true);
  });

  test("publishes the contract revision through the live capabilities surface", () => {
    const report = projectAgentSelfCapabilities();
    expect(report.workbenchContract).toMatchObject({
      id: AgentWorkbenchContract.id,
      version: AgentWorkbenchContract.version,
      revision: AgentWorkbenchContract.revision,
    });
    expect(report.workbenchContract.rules).toHaveLength(AgentWorkbenchContract.principles.length);
  });

  test("renders only the stable rule index for prompt use", () => {
    const prompt = renderAgentWorkbenchContractIndex();
    expect(prompt).toContain(`id="${AgentWorkbenchContract.id}"`);
    expect(prompt).toContain(`revision="${AgentWorkbenchContract.revision}"`);
    expect(prompt).toContain('id="evidence.first"');
    expect(prompt).not.toContain("先读取运行时快照");
  });
});
