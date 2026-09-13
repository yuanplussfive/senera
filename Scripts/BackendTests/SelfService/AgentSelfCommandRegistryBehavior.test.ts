import { describe, expect, test } from "vitest";
import {
  AgentSelfCommandRegistry,
  agentSelfCommandId,
  findAgentSelfCommandSpec,
  projectAgentSelfCommandCapabilities,
  renderAgentSelfCliHelp,
} from "../../../Source/AgentSystem/SelfService/AgentSelfCommandRegistry.js";
import { parseAgentSelfCliCommand } from "../../../Source/AgentSystem/SelfService/AgentSelfCliParser.js";
import {
  assertAgentSelfCommandContract,
  projectAgentSelfCommandContract,
} from "../../../Source/AgentSystem/SelfService/AgentSelfCommandContract.js";

describe("senera self command registry", () => {
  test("keeps the executable Zod command contract aligned with the CLI registry", () => {
    expect(() => assertAgentSelfCommandContract()).not.toThrow();
    const contract = projectAgentSelfCommandContract();
    expect(contract.version).toBe(1);
    expect(contract.revision).toMatch(/^[a-f0-9]{64}$/u);
    expect(contract.builtInCommands).toContain("session.model");
  });

  test("every registry spec resolves through findAgentSelfCommandSpec", () => {
    for (const spec of AgentSelfCommandRegistry) {
      expect(findAgentSelfCommandSpec(spec.command, spec.action)).toBe(spec);
    }
  });

  test("unknown specs resolve to undefined", () => {
    expect(findAgentSelfCommandSpec("config", "frobnicate")).toBeUndefined();
    expect(findAgentSelfCommandSpec("unknown", undefined)).toBeUndefined();
    expect(findAgentSelfCommandSpec("preset", "reset")?.action).toBe("use");
  });

  test("sensitive commands are marked", () => {
    const update = findAgentSelfCommandSpec("config", "update");
    const rollback = findAgentSelfCommandSpec("config", "rollback");
    expect(update?.sensitive).toBe(true);
    expect(rollback?.sensitive).toBe(true);
    expect(findAgentSelfCommandSpec("config", "get")?.sensitive).toBeUndefined();
  });

  test("help text lists every registry family and usage", () => {
    const help = renderAgentSelfCliHelp();
    for (const spec of AgentSelfCommandRegistry) {
      expect(help).toContain(spec.usage);
    }
    expect(help).toContain("senera config");
    expect(help).toContain("senera preset");
    expect(help).toContain("senera sessions");
    expect(help).toContain("senera logs");
    expect(help).toContain("senera status");
    expect(help).toContain("senera approval");
    expect(help).toContain("--json");
    expect(help).toContain("--yes / --no");
  });

  test("help text documents the approval flow", () => {
    const help = renderAgentSelfCliHelp();
    expect(help).toContain("敏感配置路径");
    expect(help).toContain("runtime.json");
  });

  test("projects one capability entry per registry command", () => {
    const capabilities = projectAgentSelfCommandCapabilities();
    expect(capabilities.map((entry) => entry.id)).toContain("capabilities");
    expect(new Set(capabilities.map((entry) => entry.id)).size).toBe(capabilities.length);
    for (const spec of AgentSelfCommandRegistry) {
      expect(capabilities).toContainEqual(
        expect.objectContaining({ id: agentSelfCommandId(spec.command, spec.action) }),
      );
    }
    expect(capabilities).toContainEqual(expect.objectContaining({ id: "preset.use", actionAliases: ["reset"] }));
  });

  test("keeps session model CLI positions conditional on the operation", () => {
    expect(parseAgentSelfCliCommand(["session", "model", "get", "session-a"])).toEqual({
      command: "session",
      action: "model",
      operation: "get",
      sessionId: "session-a",
    });
    expect(parseAgentSelfCliCommand(["session", "model", "set", "gpt-5.6", "session-a"])).toEqual({
      command: "session",
      action: "model",
      operation: "set",
      modelProviderId: "gpt-5.6",
      sessionId: "session-a",
    });
  });
});
