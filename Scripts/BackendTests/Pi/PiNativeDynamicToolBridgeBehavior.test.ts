import { describe, expect, test, vi } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentJsonSchemaPromptContractProjector } from "../../../Source/AgentSystem/ToolContracts/AgentJsonSchemaPromptContractProjector.js";
import {
  AgentPiNativeToolBridgeName,
  AgentPiNativeToolBridgeParameterSchema,
} from "../../../Source/AgentSystem/Pi/AgentPiNativeToolBridge.js";
import { AgentPiToolRegistryProjector } from "../../../Source/AgentSystem/Pi/AgentPiToolRegistryProjector.js";
import type { AgentPiToolExecutionBridge } from "../../../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { projectToolDescription } from "../../../Source/AgentSystem/ToolSearch/AgentToolMetaToolProjector.js";
import { createTool } from "../ToolSearch/ToolSearchTestFixtures.js";
import { createAgentToolContractDelivery } from "../../../Source/AgentSystem/ToolSearch/AgentToolContractDelivery.js";
import { createAgentPiToolObservation } from "../../../Source/AgentSystem/Pi/AgentPiToolObservation.js";
import {
  AgentToolDescriptionProtocol,
  AgentToolPreparationProtocol,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolMetaToolProtocol.js";

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

  test("exposes only explicitly selected dynamic tools as native schemas", async () => {
    const registry = toolRegistry();
    const execute = vi.fn(async () => ({ content: [], details: { senera: { toolName: WeatherToolName } } }));
    const projector = createProjector(registry, "native", { execute } as unknown as AgentPiToolExecutionBridge);
    const grant = grantFor(WeatherToolName);
    const tools = projector
      .createToolSet(["ToolDescribe", "ToolSearch", WeatherToolName, CalendarToolName], [], undefined, [
        WeatherToolName,
      ])
      .materialize(() => ({ toolAccessGrant: grant }));

    expect(tools.map((tool) => tool.name)).toEqual([
      "ToolDescribe",
      "ToolSearch",
      WeatherToolName,
      AgentPiNativeToolBridgeName,
    ]);
    expect(tools.find((tool) => tool.name === CalendarToolName)).toBeUndefined();

    const weather = tools.find((tool) => tool.name === WeatherToolName);
    if (!weather) throw new Error("Expected the explicitly selected tool.");
    await weather.execute("call-weather-direct", { city: "上海" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: expect.objectContaining({ name: WeatherToolName }),
        toolCallId: "call-weather-direct",
        params: { city: "上海" },
      }),
    );
  });

  test("uses a package declaration to keep BAML-only management tools out of the native schema", () => {
    const registry = toolRegistry();
    const bamlOnly = registry.getTool("ToolLoad");
    if (!bamlOnly) throw new Error("Expected ToolLoad.");
    registry.replaceToolExtension(bamlOnly.owner, [{ ...bamlOnly, planningModes: ["baml"] }]);

    expect(createProjector(registry, "native").createToolSet().activeToolNames).not.toContain("ToolLoad");
    expect(createProjector(registry, "baml").createToolSet(["ToolLoad"]).activeToolNames).toContain("ToolLoad");
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
    expect(description).toEqual([
      WeatherToolName,
      WeatherToolName,
      expect.stringMatching(/args:[\s\S]*city: string[\s\S]*returns:[\s\S]*boundary:/),
    ]);
    expect(JSON.stringify(description)).not.toContain("revision");
    expect(JSON.stringify(description)).not.toContain("xml");
  });

  test("unwraps an authorized current contract into the real tool for preflight and execution", async () => {
    const registry = toolRegistry();
    const execute = vi.fn(async () => ({ content: [], details: { senera: { toolName: WeatherToolName } } }));
    const projector = createProjector(registry, "native", { execute } as unknown as AgentPiToolExecutionBridge);
    const grant = grantFor(WeatherToolName);
    const toolExposure = confirmedExposure(grant, WeatherToolName, ContractDigest);
    const input = {
      tool: WeatherToolName,
      arguments: { city: "上海" },
    };

    const projection = projector.projectPreflight(
      { toolCallId: "call-weather", toolName: AgentPiNativeToolBridgeName, input },
      grant,
      undefined,
      toolExposure,
    );
    expect(projection).toEqual({
      bridged: true,
      event: { toolCallId: "call-weather", toolName: WeatherToolName, input: { city: "上海" } },
    });

    const bridge = projector
      .createToolSet(["ToolDescribe", "ToolSearch", WeatherToolName])
      .materialize(() => ({ toolAccessGrant: grant, toolExposure }))
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

  test("completes missing arguments from the same confirmed capability evidence", async () => {
    const registry = toolRegistry();
    const execute = vi.fn(async () => ({ content: [], details: { senera: { toolName: WeatherToolName } } }));
    const projector = createProjector(registry, "native", { execute } as unknown as AgentPiToolExecutionBridge);
    const grant = grantFor(WeatherToolName);
    const toolExposure = confirmedExposure(grant, WeatherToolName, ContractDigest);
    const reusableCapabilities = [
      {
        toolName: WeatherToolName,
        catalogRevision: "catalog-v1",
        contractDigest: ContractDigest,
        query: "weather in Shanghai",
        arguments: { city: "上海" },
        confirmedAt: 1,
        lastUsedAt: 1,
      },
    ] as const;
    const projection = projector.projectPreflight(
      {
        toolCallId: "call-reuse",
        toolName: AgentPiNativeToolBridgeName,
        input: { tool: WeatherToolName, arguments: {} },
      },
      grant,
      reusableCapabilities,
      toolExposure,
    );
    expect(projection.event).toMatchObject({ toolName: WeatherToolName, input: { city: "上海" } });

    const bridge = projector
      .createToolSet(["ToolDescribe", "ToolSearch", WeatherToolName])
      .materialize(() => ({ toolAccessGrant: grant, toolExposure, reusableCapabilities }))
      .find((tool) => tool.name === AgentPiNativeToolBridgeName);
    if (!bridge) throw new Error("Expected the native ToolCall bridge.");
    await bridge.execute("call-reuse", { tool: WeatherToolName, arguments: {} });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ params: { city: "上海" } }));
  });

  test("rejects undeclared bridge fields instead of silently changing a model call", () => {
    const registry = toolRegistry();
    const execute = vi.fn(async () => ({ content: [], details: { senera: { toolName: WeatherToolName } } }));
    const projector = createProjector(registry, "native", { execute } as unknown as AgentPiToolExecutionBridge);
    const grant = grantFor(WeatherToolName);
    const bridge = projector
      .createToolSet(["ToolDescribe", "ToolSearch", WeatherToolName])
      .materialize(() => ({
        toolAccessGrant: grant,
        toolExposure: confirmedExposure(grant, WeatherToolName, ContractDigest),
      }))
      .find((tool) => tool.name === AgentPiNativeToolBridgeName);
    if (!bridge) throw new Error("Expected the native ToolCall bridge.");

    expect(() =>
      bridge.execute("call-extra", {
        tool: WeatherToolName,
        unexpected: "not-part-of-the-bridge-contract",
        arguments: { city: "上海" },
      }),
    ).toThrow(/unexpected/u);
    expect(execute).not.toHaveBeenCalled();
  });

  test("publishes a strict wrapper schema to native providers", () => {
    expect(AgentPiNativeToolBridgeParameterSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
  });

  test("rejects unauthorized dynamic targets before execution", async () => {
    const registry = toolRegistry();
    const execute = vi.fn();
    const projector = createProjector(registry, "native", { execute } as unknown as AgentPiToolExecutionBridge);
    const bridge = projector
      .createToolSet(["ToolDescribe", "ToolSearch", WeatherToolName])
      .materialize(() => ({ toolAccessGrant: grantFor(WeatherToolName) }))
      .find((tool) => tool.name === AgentPiNativeToolBridgeName);
    if (!bridge) throw new Error("Expected the native ToolCall bridge.");

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

  test("tells the model to call resident tools directly instead of routing them through ToolCall", () => {
    const registry = toolRegistry();
    const projector = createProjector(registry, "native");
    const bridge = projector
      .createToolSet(["ToolDescribe", "ToolSearch", WeatherToolName])
      .materialize(() => ({ toolAccessGrant: grantFor(WeatherToolName) }))
      .find((tool) => tool.name === AgentPiNativeToolBridgeName);
    if (!bridge) throw new Error("Expected the native ToolCall bridge.");

    expect(() => bridge.execute("call-resident", { tool: "ToolSearch", arguments: { query: "weather" } })).toThrow(
      /直接调用/u,
    );
  });

  test("returns the current contract before an unprepared dynamic call", async () => {
    const registry = toolRegistry();
    const execute = vi.fn();
    const projector = createProjector(registry, "native", { execute } as unknown as AgentPiToolExecutionBridge);
    const grant = grantFor(WeatherToolName);
    const toolExposure = new AgentToolExposureState(grant);
    const bridge = projector
      .createToolSet(["ToolDescribe", "ToolSearch", WeatherToolName])
      .materialize(() => ({ toolAccessGrant: grant, toolExposure }))
      .find((tool) => tool.name === AgentPiNativeToolBridgeName);
    if (!bridge) throw new Error("Expected the native ToolCall bridge.");

    expect(() => bridge.execute("call-unconfirmed", { tool: WeatherToolName, arguments: { city: "上海" } })).toThrow(
      /not_started/,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  test("restores a delivered contract after restart without requiring a successful invocation", async () => {
    const registry = toolRegistry();
    const execute = vi.fn(async () => ({ content: [], details: { senera: { toolName: WeatherToolName } } }));
    const projector = createProjector(registry, "native", { execute } as unknown as AgentPiToolExecutionBridge);
    const grant = grantFor(WeatherToolName);
    const toolExposure = new AgentToolExposureState(grant);
    const tool = registry.getTool(WeatherToolName)!;
    const delivery = createAgentToolContractDelivery(tool, ["Local"]);
    const context = {
      messages: [
        {
          role: "toolResult" as const,
          toolCallId: "earlier-description",
          toolName: "ToolDescribe",
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                createAgentPiToolObservation({
                  status: "success",
                  execution_status: "completed",
                  output_availability: "complete",
                  detail: {
                    evidence: [],
                    result: { type: AgentToolDescriptionProtocol.type, tools: [delivery.description] },
                  },
                }),
              ),
            },
          ],
          details: { senera: { toolContractReceipts: [delivery.receipt] } },
          isError: false,
          timestamp: 1,
        },
      ],
    };
    projector.synchronizeContractEvidence(context, toolExposure);
    const projection = projector.projectPreflight(
      {
        toolCallId: "call-memory",
        toolName: AgentPiNativeToolBridgeName,
        input: { tool: WeatherToolName, arguments: { city: "上海" } },
      },
      grant,
      undefined,
      toolExposure,
    );
    expect(projection.event).toMatchObject({ toolName: WeatherToolName, input: { city: "上海" } });
    const bridge = projector
      .createToolSet(["ToolDescribe", "ToolSearch", WeatherToolName])
      .materialize(() => ({ toolAccessGrant: grant, toolExposure }))
      .find((candidate) => candidate.name === AgentPiNativeToolBridgeName)!;
    await bridge.execute("call-memory", { tool: WeatherToolName, arguments: { city: "上海" } });
    expect(execute).toHaveBeenCalledOnce();

    projector.synchronizeContractEvidence({ messages: [] }, toolExposure);
    expect(() => bridge.execute("call-compacted", { tool: WeatherToolName, arguments: { city: "上海" } })).toThrow(
      /not_started/,
    );
    expect(execute).toHaveBeenCalledOnce();

    registry.replaceToolExtension(tool.owner, [{ ...tool, contract: { ...tool.contract!, digest: "replacement" } }]);
    projector.synchronizeContractEvidence(context, toolExposure);
    expect(() => bridge.execute("call-replaced", { tool: WeatherToolName, arguments: { city: "上海" } })).toThrow(
      /not_started/,
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  test("returns schema-derived argument issues with the current contract without executing", async () => {
    const registry = toolRegistry();
    const execute = vi.fn();
    const projector = createProjector(registry, "native", { execute } as unknown as AgentPiToolExecutionBridge);
    const grant = grantFor(WeatherToolName);
    const toolExposure = confirmedExposure(grant, WeatherToolName, ContractDigest);
    const bridge = projector
      .createToolSet(["ToolDescribe", "ToolSearch", WeatherToolName])
      .materialize(() => ({ toolAccessGrant: grant, toolExposure }))
      .find((candidate) => candidate.name === AgentPiNativeToolBridgeName)!;
    let feedback: unknown;
    try {
      await bridge.execute("wrong-arguments", { tool: WeatherToolName, arguments: { ref: "@e5" } });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      feedback = JSON.parse(error.message);
    }
    expect(feedback).toMatchObject({
      execution_status: "not_started",
      detail: {
        result: {
          type: AgentToolPreparationProtocol.type,
          reason: "invalid_arguments",
          contract: [WeatherToolName, WeatherToolName, expect.stringContaining("city: string")],
          issues: expect.arrayContaining([
            expect.objectContaining({ path: "/city", keyword: "required" }),
            expect.objectContaining({ path: "/ref", keyword: "additionalProperties" }),
          ]),
        },
      },
    });
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

function confirmedExposure(
  grant: ReturnType<typeof grantFor>,
  toolName: string,
  contractDigest: string,
): AgentToolExposureState {
  const exposure = new AgentToolExposureState(grant);
  exposure.confirmContract(toolName, contractDigest);
  return exposure;
}
