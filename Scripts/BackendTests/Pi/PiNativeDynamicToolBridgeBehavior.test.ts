import { describe, expect, test, vi } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentJsonSchemaPromptContractProjector } from "../../../Source/AgentSystem/ToolContracts/AgentJsonSchemaPromptContractProjector.js";
import { AgentPiNativeToolBridgeName } from "../../../Source/AgentSystem/Pi/AgentPiNativeToolBridge.js";
import { AgentPiToolRegistryProjector } from "../../../Source/AgentSystem/Pi/AgentPiToolRegistryProjector.js";
import type { AgentPiToolExecutionBridge } from "../../../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { projectToolDescription } from "../../../Source/AgentSystem/ToolSearch/AgentToolMetaToolProjector.js";
import { createTool } from "../ToolSearch/ToolSearchTestFixtures.js";

const contracts = new AgentJsonSchemaPromptContractProjector();
const WeatherToolName = "WeatherTool";
const CalendarToolName = "CalendarTool";
const ContractDigest = "weather-contract-v1";

describe("Pi native dynamic tool bridge", () => {
  test("keeps the native provider tool table fixed while dynamic authorization changes", () => {
    const registry = toolRegistry();
    const projector = createProjector(registry, "native");
    const bootstrap = ["ToolDescribe", "ToolSearch"];

    const weather = projector.createToolSet([...bootstrap, WeatherToolName]);
    const calendar = projector.createToolSet([...bootstrap, CalendarToolName]);

    expect(weather.activeToolNames).toEqual([...bootstrap, AgentPiNativeToolBridgeName]);
    expect(calendar.activeToolNames).toEqual([...bootstrap, AgentPiNativeToolBridgeName]);
    expect(calendar.fingerprint).toBe(weather.fingerprint);
    expect(weather.activeToolNames).not.toContain(WeatherToolName);
    expect(weather.activeToolNames).not.toContain("ToolLoad");
  });

  test("keeps the native call bridge stable when no dynamic tool is currently authorized", () => {
    const projector = createProjector(toolRegistry(), "native");

    expect(projector.createToolSet(["ToolDescribe", "ToolSearch"]).activeToolNames).toEqual([
      "ToolDescribe",
      "ToolSearch",
      AgentPiNativeToolBridgeName,
    ]);
  });

  test("preserves direct dynamic tool projection for BAML", () => {
    const registry = toolRegistry();
    const projector = createProjector(registry, "baml");

    expect(projector.createToolSet(["ToolSearch", "ToolLoad", WeatherToolName]).activeToolNames).toEqual([
      "ToolSearch",
      "ToolLoad",
      WeatherToolName,
    ]);
  });

  test("describes the authoritative TypeScript-like invocation contract without exposing its digest", () => {
    const tool = toolRegistry().getTool(WeatherToolName);
    if (!tool) throw new Error("Expected the weather tool.");

    const description = projectToolDescription(tool);
    expect(description).toMatchObject({
      contract: {
        typescript: { lines: { item: expect.arrayContaining([expect.stringContaining("city: string")]) } },
        requiredInputs: { item: [expect.objectContaining({ name: "city", type: "string" })] },
      },
    });
    expect(description.contract).not.toHaveProperty("revision");
  });

  test("unwraps an authorized current contract into the real tool for preflight and execution", async () => {
    const registry = toolRegistry();
    const execute = vi.fn(async () => ({ content: [], details: { senera: { toolName: WeatherToolName } } }));
    const projector = createProjector(registry, "native", { execute } as unknown as AgentPiToolExecutionBridge);
    const grant = grantFor(WeatherToolName);
    const input = {
      tool: WeatherToolName,
      arguments: { city: "上海" },
    };

    const projection = projector.projectPreflight(
      { toolCallId: "call-weather", toolName: AgentPiNativeToolBridgeName, input },
      grant,
    );
    expect(projection).toEqual({
      bridged: true,
      event: { toolCallId: "call-weather", toolName: WeatherToolName, input: { city: "上海" } },
    });

    const bridge = projector
      .createToolSet(["ToolDescribe", "ToolSearch", WeatherToolName])
      .materialize(() => ({ toolAccessGrant: grant }))
      .find((tool) => tool.name === AgentPiNativeToolBridgeName);
    if (!bridge) throw new Error("Expected the native ToolCall bridge.");
    await bridge.execute("call-weather", input);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: expect.objectContaining({ name: WeatherToolName }),
        toolCallId: "call-weather",
        params: { city: "上海" },
        context: expect.objectContaining({ toolAccessGrant: grant }),
      }),
    );
  });

  test("rejects undeclared bridge fields and unauthorized dynamic targets before execution", async () => {
    const registry = toolRegistry();
    const execute = vi.fn();
    const projector = createProjector(registry, "native", { execute } as unknown as AgentPiToolExecutionBridge);
    const bridge = projector
      .createToolSet(["ToolDescribe", "ToolSearch", WeatherToolName])
      .materialize(() => ({ toolAccessGrant: grantFor(WeatherToolName) }))
      .find((tool) => tool.name === AgentPiNativeToolBridgeName);
    if (!bridge) throw new Error("Expected the native ToolCall bridge.");

    expect(() =>
      bridge.execute("call-invalid", {
        tool: WeatherToolName,
        unexpected: "not-part-of-the-bridge-contract",
        arguments: { city: "上海" },
      }),
    ).toThrow();
    expect(() =>
      projector.projectPreflight(
        {
          toolCallId: "call-unauthorized",
          toolName: AgentPiNativeToolBridgeName,
          input: { tool: CalendarToolName, arguments: {} },
        },
        grantFor(WeatherToolName),
      ),
    ).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});

function createProjector(
  registry: AgentExtensionRegistry,
  toolPlanningMode: "native" | "baml",
  execution: AgentPiToolExecutionBridge = {
    execute: async () => ({ content: [], details: { senera: { toolName: "test" } } }),
  } as unknown as AgentPiToolExecutionBridge,
): AgentPiToolRegistryProjector {
  return new AgentPiToolRegistryProjector({
    config: { ModelProviders: [] },
    registry,
    toolPlanningMode,
    execution,
    availableExecutionTargets: () => ["Local"],
  });
}

function toolRegistry(): AgentExtensionRegistry {
  const registry = new AgentExtensionRegistry();
  for (const tool of [
    registeredTool("ToolSearch", "Bootstrap", "search-contract-v1"),
    registeredTool("ToolDescribe", "Bootstrap", "describe-contract-v1"),
    registeredTool("ToolLoad", "Bootstrap", "load-contract-v1"),
    registeredTool("ToolUnload", "Bootstrap", "unload-contract-v1"),
    registeredTool(WeatherToolName, "Dynamic", ContractDigest),
    registeredTool(CalendarToolName, "Dynamic", "calendar-contract-v1"),
  ]) {
    registry.registerToolExtension(tool.owner, [tool]);
  }
  return registry;
}

function registeredTool(name: string, loading: "Bootstrap" | "Dynamic", digest: string): RegisteredTool {
  const tool = createTool({
    name,
    title: name,
    summary: `${name} test tool`,
    tags: ["test"],
    actions: ["execute"],
    targets: ["test"],
    priority: 1,
    loading,
  });
  const schema = {
    type: "object",
    properties: { city: { type: "string", description: "目标城市。" } },
    required: name === WeatherToolName ? ["city"] : [],
    additionalProperties: false,
  };
  tool.contract = { digest, arguments: contracts.project(schema) };
  return tool;
}

function grantFor(dynamicToolName: string) {
  return createAgentToolAccessGrant({
    authorizedToolNames: ["ToolDescribe", "ToolSearch", dynamicToolName],
    exposedToolNames: ["ToolDescribe", "ToolSearch"],
  });
}
