import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentMcpInputService } from "../../../Source/AgentSystem/Credentials/AgentMcpInputService.js";
import type { AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentMcpManagementService } from "../../../Source/AgentSystem/McpPackages/AgentMcpManagementService.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentWebSocketRequestSchema } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketProtocol.js";
import { projectAgentWebSocketRequestFailure } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketRequestFailures.js";
import { AgentWebSocketToolSettingsRequestHandlers } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketSettingsRequestHandlers.js";
import type { AgentWebSocketRequestContext } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();
const inputServices = new Set<AgentMcpInputService>();

afterEach(() => {
  for (const service of inputServices) service.close();
  inputServices.clear();
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("MCP management", () => {
  test("reuses revision-driven discovery snapshots and limits input invalidation to MCP settings", () => {
    const { management } = createManagement();

    const firstSystem = management.systemSettingsSnapshot();
    const firstMcp = management.mcpSettingsSnapshot();
    expect(management.systemSettingsSnapshot()).toBe(firstSystem);
    expect(management.listSystemExtensions()).toBe(firstSystem.extensions);
    expect(management.listSystemTools()).toBe(firstSystem.tools);
    expect(management.mcpSettingsSnapshot()).toBe(firstMcp);
    expect(management.listMcpServers()).toBe(firstMcp.servers);
    const delegation = firstSystem.extensions.find((extension) => extension.id === "agent-delegation");
    const skillField = delegation?.configuration?.sections
      .flatMap((section) => section.fields)
      .find((field) => field.path.join(".") === "defaults.skills");
    expect(skillField).toMatchObject({
      optionSource: { catalog: "skills" },
      options: expect.arrayContaining(["workspace-investigation"]),
    });

    management.setInput("credential-test", "TEST_SECRET", "snapshot-secret");

    expect(management.systemSettingsSnapshot()).toBe(firstSystem);
    expect(management.mcpSettingsSnapshot()).not.toBe(firstMcp);
    expect(JSON.stringify(management.mcpSettingsSnapshot())).not.toContain("snapshot-secret");
  });

  test("invalidates discovery snapshots only when their configuration or source revisions change", () => {
    let config: AgentSystemConfig = { ModelProviders: [] };
    const { management, workspaceRoot } = createManagement(() => config);
    const firstSystem = management.systemSettingsSnapshot();
    const firstMcp = management.mcpSettingsSnapshot();

    config = { ...config, Extensions: {} };
    const configuredSystem = management.systemSettingsSnapshot();
    const configuredMcp = management.mcpSettingsSnapshot();
    expect(configuredSystem).not.toBe(firstSystem);
    expect(configuredMcp).not.toBe(firstMcp);

    const mcpRoot = resolveAgentWorkspaceLayout(workspaceRoot).mcpRoot;
    fs.mkdirSync(mcpRoot, { recursive: true });
    fs.writeFileSync(path.join(mcpRoot, ".source-revision"), "changed", "utf8");

    expect(management.systemSettingsSnapshot()).toBe(configuredSystem);
    expect(management.mcpSettingsSnapshot()).not.toBe(configuredMcp);
  });

  test("projects typed inputs without exposing Secret values and isolates them by server", () => {
    const { inputs, management } = createManagement();
    const secret = "credential-test-secret-that-must-not-be-projected";

    expect(management.listMcpServers()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "credential-test",
          status: "needs_input",
          inputs: expect.arrayContaining([
            expect.objectContaining({ id: "TEST_SECRET", secret: true, configured: false, source: "missing" }),
          ]),
        }),
        expect.objectContaining({
          id: "weather",
          status: "needs_input",
          inputs: expect.arrayContaining([
            expect.objectContaining({ id: "QWEATHER_API_KEY", secret: true, configured: false, source: "missing" }),
          ]),
        }),
      ]),
    );

    management.setInput("credential-test", "TEST_SECRET", secret);

    const servers = management.listMcpServers();
    expect(servers.find((server) => server.id === "credential-test")).toMatchObject({
      status: "configured",
      inputs: expect.arrayContaining([
        expect.objectContaining({ id: "TEST_SECRET", configured: true, source: "vault" }),
      ]),
    });
    expect(servers.find((server) => server.id === "weather")?.status).toBe("needs_input");
    expect(JSON.stringify(servers)).not.toContain(secret);
    expect(inputs.resolve("weather", { source: "secret", inputId: "TEST_SECRET" })).toBeUndefined();
  });

  test("accepts only declared variables and includes server identity in restart revisions", () => {
    const { management } = createManagement();
    const initial = management.revision();

    expect(() => management.setInput("credential-test", "UNDECLARED", "value")).toThrow(/does not declare input/u);

    management.restart("weather");
    const weatherRestart = management.revision();
    management.restart("credential-test");
    const bothRestarted = management.revision();

    expect(weatherRestart).not.toBe(initial);
    expect(weatherRestart).toContain("weather=1");
    expect(bothRestarted).toContain("weather=1");
    expect(bothRestarted).toContain("credential-test=1");
  });

  test("validates input request boundaries and descriptor-owned value types", () => {
    const { management } = createManagement();
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "mcpInput.set",
        serverId: "credential-test",
        inputId: "TEST_SECRET",
        value: "secret",
      }).success,
    ).toBe(true);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "mcpInput.set",
        serverId: "credential-test",
        inputId: "",
        value: "secret",
      }).success,
    ).toBe(false);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "mcpInput.set",
        serverId: "credential-test",
        inputId: "TEST_BASE_URL",
        value: true,
      }).success,
    ).toBe(true);
    expect(() => management.setInput("credential-test", "TEST_BASE_URL", true)).toThrow(/Expected string/u);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "mcpInput.delete",
        serverId: "",
        inputId: "TEST_SECRET",
      }).success,
    ).toBe(false);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "mcpInput.update",
        requestId: "mcp-update-1",
        serverId: "credential-test",
        values: { TEST_SECRET: "secret", TEST_BASE_URL: "https://example.test" },
        deletes: ["OPTIONAL_INPUT"],
      }).success,
    ).toBe(true);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "mcpInput.update",
        serverId: "credential-test",
        values: {},
      }).success,
    ).toBe(false);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "mcpInput.update",
        requestId: " ",
        serverId: "credential-test",
        values: {},
      }).success,
    ).toBe(false);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "mcpInput.update",
        requestId: "mcp-update-2",
        serverId: "credential-test",
        values: { "": "invalid" },
      }).success,
    ).toBe(false);
    expect(() => management.updateInputs("credential-test", { TEST_SECRET: "secret" }, ["TEST_SECRET"])).toThrow(
      /cannot be set and deleted together/u,
    );
  });

  test("correlates a successful batch snapshot without projecting Secret values", async () => {
    const { management } = createManagement();
    const events: AgentDomainEvent[] = [];
    const handlers = new AgentWebSocketToolSettingsRequestHandlers({
      mcpManagement: management,
    } as AgentWebSocketRequestContext);
    const secret = "batch-secret-that-must-not-enter-events";

    await handlers.updateInputs(
      {
        type: "mcpInput.update",
        requestId: "mcp-update-success",
        serverId: "credential-test",
        values: { TEST_SECRET: secret },
      },
      (event) => {
        events.push(event);
      },
    );

    expect(events).toEqual([
      expect.objectContaining({
        kind: "mcp_server.snapshot",
        data: expect.objectContaining({
          operation: { requestId: "mcp-update-success", kind: "mcp_input_update" },
        }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  test("projects settings failures without exposing credential values or failing an agent run", () => {
    const secret = "secret-that-must-not-enter-events";
    const failure = projectAgentWebSocketRequestFailure(
      {
        type: "mcpInput.set",
        serverId: "credential-test",
        inputId: "TEST_SECRET",
        value: secret,
      },
      new Error("credential rejected"),
    );

    expect(failure).toMatchObject({
      kind: "request.invalid",
      data: {
        code: "tool_settings_request_failed",
        details: {
          requestType: "mcpInput.set",
          serverId: "credential-test",
          inputId: "TEST_SECRET",
        },
      },
    });
    expect(JSON.stringify(failure)).not.toContain(secret);

    const batchFailure = projectAgentWebSocketRequestFailure(
      {
        type: "mcpInput.update",
        requestId: "mcp-update-failed",
        serverId: "credential-test",
        values: { TEST_SECRET: secret },
        deletes: ["TEST_BASE_URL"],
      },
      new Error("batch rejected"),
    );
    expect(batchFailure).toMatchObject({
      kind: "request.invalid",
      data: {
        code: "tool_settings_request_failed",
        details: {
          requestType: "mcpInput.update",
          requestId: "mcp-update-failed",
          serverId: "credential-test",
        },
      },
    });
    expect(JSON.stringify(batchFailure)).not.toContain(secret);
    expect(JSON.stringify(batchFailure)).not.toContain("TEST_BASE_URL");
  });
});

function createManagement(config: () => AgentSystemConfig = () => ({ ModelProviders: [] })): {
  workspaceRoot: string;
  inputs: AgentMcpInputService;
  management: AgentMcpManagementService;
} {
  const workspaceRoot = createTemporaryDirectory("senera-mcp-management");
  workspaces.add(workspaceRoot);
  const mcpRoot = resolveAgentWorkspaceLayout(workspaceRoot).mcpRoot;
  const packageRoot = path.join(mcpRoot, "credential-test");
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, ".mcp.json"),
    `${JSON.stringify(
      {
        mcpServers: {
          "credential-test": {
            type: "stdio",
            command: "node",
            env: {
              TEST_SECRET: ["$", "{TEST_SECRET}"].join(""),
              TEST_BASE_URL: ["$", "{TEST_BASE_URL:-https://example.test}"].join(""),
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const inputs = AgentMcpInputService.open(workspaceRoot, {});
  inputServices.add(inputs);
  return {
    workspaceRoot,
    inputs,
    management: new AgentMcpManagementService({
      workspaceRoot,
      resourcesRoot: path.resolve("."),
      inputs,
      config,
    }),
  };
}
