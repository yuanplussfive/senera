import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { LocalizedConfigFormDocumentSchema } from "../../../Source/AgentSystem/Config/AgentConfigFormDocument.js";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import {
  AgentExtensionLocales,
  resolveAgentExtensionLocalizedText,
} from "../../../Source/AgentSystem/Extensions/AgentExtensionLocalization.js";
import {
  registerAgentSystemToolHandlers,
  systemToolCapability,
} from "../../../Source/AgentSystem/SystemTools/AgentSystemToolCatalog.js";
import { AgentSystemToolContractSchema } from "../../../Source/AgentSystem/SystemTools/AgentSystemExtensionManifest.js";
import { AgentSystemExtensionCatalog } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolSource.js";
import { createAgentSystemTools } from "../../../Source/AgentSystem/SystemTools/AgentSystemTools.js";
import { buildToolCapabilityDocument } from "../../../Source/AgentSystem/ToolSearch/AgentCapabilityDocumentBuilder.js";
import { AgentToolSearchDocumentBuilder } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchDocumentBuilder.js";
import { AgentToolSearchIndex } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchIndex.js";
import { isAgentToolMetaToolName } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntimeTypes.js";
import { resolveToolSearchConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentToolResourceQueryShapes } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceDiscovery.js";
import { AgentToolResourceCapabilityIds } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceCapabilityIds.js";
import {
  isAgentToolDirectlyInvocable,
  isAgentToolDynamicallyDiscoverable,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolInvocationRouting.js";
import { AgentToolHostCapabilityRegistry } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { projectAgentToolEventOrigin } from "../../../Source/AgentSystem/ToolRuntime/AgentToolEventOrigin.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import {
  AgentHostCapabilityNames,
  listDefaultAgentHostCapabilityNames,
} from "../../../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import {
  AgentResidentActionSpeechCapability,
  AgentResidentFinalSpeechCapability,
} from "../../../Source/AgentSystem/ResidentSpeech/AgentResidentSpeechTypes.js";

describe("System Tool catalog", () => {
  test("registers code-defined host handlers while contracts remain package-owned", () => {
    const definitions = createAgentSystemTools(testConfig());
    const handlers = new AgentToolHostCapabilityRegistry();

    registerAgentSystemToolHandlers(handlers, definitions);

    for (const definition of definitions) {
      expect(handlers.get(systemToolCapability(definition))).toBeTypeOf("function");
      expect(() => z.toJSONSchema(definition.input, { target: "draft-7", io: "input" })).not.toThrow();
      expect(() => z.toJSONSchema(definition.output, { target: "draft-7", io: "output" })).not.toThrow();
    }
  });

  test("loads every host tool from System extension packages", () => {
    const registry = new AgentExtensionRegistry();
    const definitions = createAgentSystemTools(testConfig());
    const catalog = new AgentSystemExtensionCatalog();
    catalog.registerRoot(registry, path.resolve("System", "Extensions"), {
      capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]),
    });

    const extensions = catalog.listExtensions();
    expect(
      registry
        .listTools()
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(extensions.flatMap((extension) => extension.tools.map((tool) => tool.name)).sort());
    expect(registry.getTool("WorkspaceApplyPatch")).toMatchObject({
      owner: {
        kind: "system",
        name: "workspace-patch",
        title: "工作区补丁",
        description: "以原子方式应用工作区补丁，并在提交前验证受影响的扩展。",
      },
      handler: {
        kind: "HostCapability",
        capability: "workspace.apply_patch",
        resources: [
          expect.objectContaining({
            Capability: "senera.workspace.path",
            Pointer: "/operations",
            Parameters: expect.objectContaining({
              PathPointers: expect.arrayContaining(["/*/path", "/*/source"]),
            }),
          }),
        ],
      },
      runtime: { Scheduling: "ResourceClaims" },
      contract: { outputSchema: undefined },
    });
    expect(registry.getTool("WorkspaceInspectTool")).toBeUndefined();
    expect(registry.getTool("ShellCommandTool")).not.toHaveProperty("contentPolicy");
    expect(registry.getTool("WebFetch")).not.toHaveProperty("contentPolicy");
    expect(registry.getTool("ResidentActionSpeak")).toBeUndefined();
    expect(registry.getTool("ResidentFinalSpeak")).toBeUndefined();
    expect(registry.getSidecarTool(AgentResidentActionSpeechCapability)).toMatchObject({
      name: "ResidentActionSpeak",
      capability: AgentResidentActionSpeechCapability,
      owner: { kind: "system", name: "resident-speech" },
    });
    expect(registry.getSidecarTool(AgentResidentFinalSpeechCapability)).toMatchObject({
      name: "ResidentFinalSpeak",
      capability: AgentResidentFinalSpeechCapability,
      owner: { kind: "system", name: "resident-speech" },
    });
    expect(extensions.some((extension) => extension.id === "resident-speech")).toBe(false);
    expect(registry.listTools().some((tool) => tool.loading === "Bootstrap")).toBe(true);
    expect(registry.listTools().some((tool) => tool.loading === "Dynamic")).toBe(true);
    for (const [name, commandAlias, capabilityId] of [
      ["WorkspaceRead", "read", "workspace.file.read"],
      ["WorkspaceGrep", "grep", "workspace.content.search"],
      ["WorkspaceFind", "find", "workspace.file.find"],
      ["WorkspaceList", "ls", "workspace.directory.list"],
    ] as const) {
      expect(registry.getTool(name)).toMatchObject({
        owner: { kind: "system", name: "workspace-tools" },
        execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
        runtime: { Scheduling: "Parallel", Capabilities: { Cancellation: true } },
        search: {
          Tags: expect.arrayContaining([commandAlias]),
          Capabilities: [
            expect.objectContaining({ Id: capabilityId, Aliases: expect.arrayContaining([commandAlias]) }),
          ],
        },
      });
    }
    expect(registry.getTool("TavilySearchTool")).toBeUndefined();
    expect(registry.getTool("AgentSpawn")).toMatchObject({
      owner: { kind: "system", name: "agent-delegation" },
      handler: { kind: "HostCapability", capability: AgentHostCapabilityNames.AgentSpawn },
      childGrant: "delegation",
    });
    expect(registry.getTool("AgentList")).toMatchObject({
      owner: { kind: "system", name: "agent-delegation" },
      handler: { kind: "HostCapability", capability: AgentHostCapabilityNames.AgentList },
    });
    expect(registry.getTool("AgentWait")).toMatchObject({
      owner: { kind: "system", name: "agent-delegation" },
      handler: { kind: "HostCapability", capability: AgentHostCapabilityNames.AgentWait },
      runtime: {
        Lifecycle: "RemoteJob",
        Capabilities: { Progress: true, Cancellation: true, ResumableEvents: true },
      },
    });
    expect(registry.getTool("AgentInput")).toMatchObject({
      owner: { kind: "system", name: "agent-delegation" },
      handler: { kind: "HostCapability", capability: AgentHostCapabilityNames.AgentInput },
    });
    expect(registry.getTool("AgentStop")).toMatchObject({
      owner: { kind: "system", name: "agent-delegation" },
      handler: { kind: "HostCapability", capability: AgentHostCapabilityNames.AgentStop },
    });
    expect(registry.getTool("AgentResume")).toMatchObject({
      owner: { kind: "system", name: "agent-delegation" },
      handler: { kind: "HostCapability", capability: AgentHostCapabilityNames.AgentResume },
      childGrant: "delegation",
    });
    expect(registry.getTool("AgentContactSupervisor")).toMatchObject({ childGrant: "internal" });
    expect(registry.getSkill("agent-orchestration")).toMatchObject({
      source: { kind: "system", id: "agent-delegation" },
      recommendedTools: ["AgentSpawn", "AgentList", "AgentWait", "AgentInput", "AgentStop", "AgentResume"],
    });
    expect(registry.getTool("AgentSubmitStructuredResult")).toBeUndefined();
    expect(registry.getTool("AgentScheduleManage")).toMatchObject({
      owner: { kind: "system", name: "agent-scheduler" },
      handler: { kind: "HostCapability", capability: AgentHostCapabilityNames.ScheduleManage },
    });
    expect(registry.listDiscoverySources()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "orchestration" }),
        expect.objectContaining({ id: "orchestration.scheduler" }),
      ]),
    );
    for (const tool of registry.listTools()) {
      expect(tool).not.toHaveProperty("observationProjection");
    }

    expect(extensions.map((extension) => extension.id)).toEqual(
      expect.arrayContaining(["agent-delegation", "agent-scheduler"]),
    );
    const delegationExtension = extensions.find((extension) => extension.id === "agent-delegation");
    expect(delegationExtension?.skillCount).toBe(
      registry.listSkills().filter((skill) => skill.source.kind === "system" && skill.source.id === "agent-delegation")
        .length,
    );
    for (const extension of extensions) {
      expect(resolveAgentExtensionLocalizedText(extension.displayName)).not.toBe("");
      expect(resolveAgentExtensionLocalizedText(extension.displayName, AgentExtensionLocales.EnUs)).not.toBe("");
      expect(resolveAgentExtensionLocalizedText(extension.description)).not.toBe("");
      expect(resolveAgentExtensionLocalizedText(extension.description, AgentExtensionLocales.EnUs)).not.toBe("");
    }
  });

  test("projects declared System Tool search examples as semantic evidence", () => {
    const registry = systemToolRegistry();
    const documentBuilder = new AgentToolSearchDocumentBuilder();
    const omissions: Array<{ readonly tool: string; readonly example: string }> = [];

    for (const tool of registry.listTools()) {
      const capability = buildToolCapabilityDocument(tool, documentBuilder.build(tool));
      const semanticText = capability.semanticInputs.map((input) => input.text).join("\n");
      for (const example of tool.search?.Examples ?? []) {
        if (!semanticText.includes(example)) omissions.push({ tool: tool.name, example });
      }
    }

    expect(omissions).toEqual([]);
  });

  test("projects domain presentation into registered tools and their lifecycle origins", () => {
    const registry = new AgentExtensionRegistry();
    const definitions = createAgentSystemTools(testConfig());
    const catalog = new AgentSystemExtensionCatalog();
    catalog.registerRoot(registry, path.resolve("System", "Extensions"), {
      capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]),
    });

    const extension = catalog.listExtensions().find((candidate) => candidate.id === "workspace-tools");
    const tool = registry.getTool("WorkspaceRead");
    expect(extension).toMatchObject({
      settingsSurface: "system-tools",
      domain: {
        id: "explore",
        presentation: expect.objectContaining({ category: "explore", icon: "search" }),
      },
    });
    expect(tool?.presentation).toMatchObject({
      category: "workspace-read",
      icon: "file-text",
      group: { id: "workspace", title: { "zh-CN": "浏览工作区", "en-US": "Explore workspace" } },
      activity: { action: { "zh-CN": "读取文件", "en-US": "Read" }, argumentPath: "/path" },
    });
    expect(projectAgentToolEventOrigin(tool!)).toMatchObject({
      kind: "system",
      name: "工作区工具",
      presentation: tool?.presentation,
    });
  });

  test("merges domain, extension, and Tool presentation without frontend classification rules", () => {
    const root = createTemporaryDirectory("senera-system-extension-presentation-inheritance");
    try {
      const packageRoot = createTestPackage(root, "presentation-inheritance");
      fs.mkdirSync(path.join(packageRoot, "tools"), { recursive: true });
      writeJson(path.join(packageRoot, "tools", "PresentationTool.tool.json"), {
        ...minimalContract("PresentationTool"),
        presentation: {
          category: "tool-category",
          group: { title: localizedTestText("Tool group") },
          activity: {
            invocationName: localizedTestText("Tool invocation"),
            detailPaths: ["/target"],
          },
        },
      });
      writeJson(path.join(packageRoot, "extension.json"), {
        ...extensionManifest("presentation-inheritance", "tools/PresentationTool.tool.json", "shell.run"),
        presentation: {
          icon: "terminal",
          group: { id: "extension-group" },
          activity: {
            action: localizedTestText("Extension action"),
            argumentPath: "/command",
          },
        },
      });

      const registry = new AgentExtensionRegistry();
      const catalog = new AgentSystemExtensionCatalog();
      catalog.registerRoot(registry, root, { capabilities: new Set(["shell.run"]) });

      expect(catalog.listExtensions()).toEqual([
        expect.objectContaining({
          id: "presentation-inheritance",
          presentation: {
            category: "test",
            icon: "terminal",
            group: { id: "extension-group", title: localizedTestText("Test tools") },
            activity: {
              action: localizedTestText("Extension action"),
              argumentPath: "/command",
            },
          },
        }),
      ]);
      expect(registry.getTool("PresentationTool")?.presentation).toEqual({
        category: "tool-category",
        icon: "terminal",
        group: { id: "extension-group", title: localizedTestText("Tool group") },
        activity: {
          action: localizedTestText("Extension action"),
          argumentPath: "/command",
          invocationName: localizedTestText("Tool invocation"),
          detailPaths: ["/target"],
        },
      });
    } finally {
      removeDirectory(root);
    }
  });

  test("routes every complete dynamically discoverable System Tool example through declared example evidence", async () => {
    const registry = systemToolRegistry();
    const index = new AgentToolSearchIndex(registry, resolveToolSearchConfig(testConfig()));
    const loadedToolNames = registry.listTools().map((tool) => tool.name);
    const misses: Array<{ readonly tool: string; readonly example: string; readonly returned: readonly string[] }> = [];

    for (const tool of registry
      .listTools()
      .filter((tool) => isAgentToolDynamicallyDiscoverable(tool) && !isAgentToolMetaToolName(tool.name))) {
      for (const example of tool.search?.Examples ?? []) {
        const results = (await index.discoverHybrid({ query: example, loadedToolNames })).match;
        if (!results.some((result) => result.toolName === tool.name && result.ranks.example === 1)) {
          misses.push({ tool: tool.name, example, returned: results.map((result) => result.toolName) });
        }
      }
    }

    expect(misses).toEqual([]);
  });

  test("keeps direct workspace reads in the native tool table and out of dynamic discovery", async () => {
    const registry = systemToolRegistry();
    const workspaceRead = registry.getTool("WorkspaceRead");
    if (!workspaceRead) throw new Error("Expected WorkspaceRead.");
    const index = new AgentToolSearchIndex(registry, resolveToolSearchConfig(testConfig()), undefined, {
      getDiscovery: (capabilityId) =>
        capabilityId === AgentToolResourceCapabilityIds.WorkspacePath
          ? { queryShapes: [AgentToolResourceQueryShapes.Path] }
          : undefined,
    });
    const discovery = await index.discoverHybrid({
      query: "读取 package.json",
      loadedToolNames: registry.listTools().map((tool) => tool.name),
    });

    expect(isAgentToolDirectlyInvocable(workspaceRead)).toBe(true);
    expect(index.getToolNames()).not.toContain(workspaceRead.name);
    expect(
      [...discovery.match, ...discovery.maybe, ...discovery.omitted].map((result) => result.toolName),
    ).not.toContain(workspaceRead.name);
  });

  test("routes dynamic operations through search while keeping resident system operations direct", async () => {
    const registry = systemToolRegistry();
    const index = new AgentToolSearchIndex(registry, resolveToolSearchConfig(testConfig()));
    const loadedToolNames = registry.listTools().map((tool) => tool.name);
    const dynamicCases = [["截取当前网页", "BrowserScreenshot"]] as const;

    for (const [query, toolName] of dynamicCases) {
      const discovery = await index.discoverHybrid({ query, loadedToolNames });
      expect(
        [...discovery.match, ...discovery.maybe].map((result) => result.toolName),
        query,
      ).toContain(toolName);
    }

    const directToolNames = [
      "GitInspect",
      "ExecutionResourceList",
      "ExecutionResourceInspect",
      "ExecutionResourceResize",
      "ExecutionResourceSignal",
      "ExecutionResourceStopAll",
      "ExecutionResourceWait",
      "ExecutionResourceWrite",
      "TerminalStartTool",
    ];
    for (const toolName of directToolNames) {
      const tool = registry.getTool(toolName);
      expect(tool, toolName).toBeDefined();
      if (tool) expect(isAgentToolDirectlyInvocable(tool), toolName).toBe(true);
      expect(index.getToolNames(), toolName).not.toContain(toolName);
    }
  });

  test("rejects extension packages with incomplete localized metadata", () => {
    const root = createTemporaryDirectory("senera-system-extension-localization");
    try {
      const packageRoot = createTestPackage(root, "incomplete-localization");
      fs.mkdirSync(path.join(packageRoot, "tools"), { recursive: true });
      writeJson(path.join(packageRoot, "tools", "Test.tool.json"), minimalContract("TestTool"));
      writeJson(path.join(packageRoot, "extension.json"), {
        ...extensionManifest("incomplete-localization", "tools/Test.tool.json", "shell.run"),
        displayName: { "zh-CN": "不完整本地化" },
      });

      expect(() =>
        new AgentSystemExtensionCatalog().registerRoot(new AgentExtensionRegistry(), root, {
          capabilities: new Set(["shell.run"]),
        }),
      ).toThrow(/JSON 结构校验失败/u);
    } finally {
      removeDirectory(root);
    }
  });

  test("rejects System Tool capabilities without a declared retrieval alias", () => {
    const contract = minimalContract("TestTool");
    contract.search.Capabilities[0]!.Aliases = [];

    const parsed = AgentSystemToolContractSchema.safeParse(contract);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["search", "Capabilities", 0, "Aliases"],
          message: "System Tool capabilities must declare at least one operation alias for ToolSearch.",
        }),
      ]),
    );
  });

  test("projects image analysis configuration with localized form metadata", () => {
    const registry = new AgentExtensionRegistry();
    const config = testConfig();
    config.Extensions = {
      "agent-image-tools": {
        Configuration: {
          model: { modelProviderId: "test-model" },
          input: { maxImageBytes: 8_388_608 },
        },
      },
    };
    const definitions = createAgentSystemTools(config);
    const catalog = new AgentSystemExtensionCatalog();
    catalog.registerRoot(registry, path.resolve("System", "Extensions"), {
      capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]),
      configurations: config.Extensions,
    });

    const extension = catalog.listExtensions().find((item) => item.id === "agent-image-tools");
    expect(extension?.configuration).toMatchObject({
      configured: true,
      value: {
        model: { modelProviderId: "test-model" },
        input: { maxImageBytes: 8_388_608 },
      },
      effectiveValue: {
        model: { modelProviderId: "test-model" },
        input: { maxImageBytes: 8_388_608 },
      },
    });
    expect(extension?.configuration?.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "model",
          label: { "zh-CN": "模型选择", "en-US": "Model selection" },
          fields: expect.arrayContaining([
            expect.objectContaining({
              path: ["model", "modelProviderId"],
              effectiveValue: "test-model",
              label: { "zh-CN": "视觉模型", "en-US": "Vision model" },
              modelSelection: expect.objectContaining({ capability: "Vision", valueKind: "model-id" }),
            }),
          ]),
        }),
      ]),
    );
  });

  test("projects package-owned configuration and disables all contributions as one unit", () => {
    const registry = new AgentExtensionRegistry();
    const config = testConfig();
    config.Extensions = {
      "agent-document-tools": {
        Enabled: false,
        Configuration: { output: { maxChunks: 7 } },
      },
    };
    const definitions = createAgentSystemTools(config);
    const catalog = new AgentSystemExtensionCatalog();
    catalog.registerRoot(registry, path.resolve("System", "Extensions"), {
      capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]),
      configurations: config.Extensions,
    });

    expect(registry.getTool("DocumentExtract")).toBeUndefined();
    const extension = catalog.listExtensions().find((item) => item.id === "agent-document-tools");
    expect(extension).toMatchObject({ enabled: false, configured: true, tools: [{ name: "DocumentExtract" }] });
    for (const tool of extension?.tools ?? []) expect(registry.getTool(tool.name)).toBeUndefined();
    expect(extension?.configuration).toMatchObject({
      configured: true,
      value: { output: { maxChunks: 7 } },
      effectiveValue: { output: { maxChunks: 7, maxChunkChars: 1600 } },
    });
    expect(extension?.configuration?.sections.flatMap((section) => section.fields)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["output", "maxChunks"], effectiveValue: 7, configured: true }),
      ]),
    );
  });

  test("rejects multiple extensions that claim one dedicated settings surface", () => {
    const root = createTemporaryDirectory("senera-system-extension-settings-surface");
    try {
      const schema = {
        type: "object",
        properties: { enabled: { type: "boolean", default: true } },
        additionalProperties: false,
      };
      const first = writeConfigurableExtension(root, "first-channel-surface", schema);
      const second = writeConfigurableExtension(root, "second-channel-surface", schema);
      for (const packageRoot of [first, second]) {
        const manifestPath = path.join(packageRoot, "extension.json");
        writeJson(manifestPath, { ...readJson(manifestPath), settingsSurface: "channels" });
      }

      expect(() =>
        new AgentSystemExtensionCatalog().registerRoot(new AgentExtensionRegistry(), root, {
          capabilities: new Set(["shell.run"]),
        }),
      ).toThrow(/System settings surface 'channels' is declared by both/u);
    } finally {
      removeDirectory(root);
    }
  });

  test("rejects unknown extensions and invalid package configuration values", () => {
    const definitions = createAgentSystemTools(testConfig());
    const capabilities = new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]);
    expect(() =>
      new AgentSystemExtensionCatalog().registerRoot(
        new AgentExtensionRegistry(),
        path.resolve("System", "Extensions"),
        { capabilities, configurations: { missing: { Enabled: false } } },
      ),
    ).toThrow(/unknown System extensions: missing/u);
    expect(() =>
      new AgentSystemExtensionCatalog().registerRoot(
        new AgentExtensionRegistry(),
        path.resolve("System", "Extensions"),
        {
          capabilities,
          configurations: {
            "agent-document-tools": { Configuration: { output: { maxChunks: -1 } } },
          },
        },
      ),
    ).toThrow(/agent-document-tools configuration is invalid/u);
    expect(() =>
      createAgentSystemTools({
        ...testConfig(),
        Extensions: {
          "agent-image-tools": { Configuration: { input: { maxImageBytes: 1 } } },
        },
      }),
    ).toThrow();
  });

  test("derives a complete settings form when a package omits its optional UI schema", () => {
    const root = createTemporaryDirectory("senera-system-extension-derived-ui");
    try {
      writeConfigurableExtension(root, "derived-ui", {
        type: "object",
        properties: {
          enabled: { type: "boolean", title: "Enabled", default: true },
          limit: { type: "integer", title: "Limit", minimum: 1, default: 3 },
        },
        additionalProperties: false,
      });
      const catalog = new AgentSystemExtensionCatalog();
      catalog.registerRoot(new AgentExtensionRegistry(), root, { capabilities: new Set(["shell.run"]) });

      const configuration = catalog.listExtensions()[0]?.configuration;
      expect(configuration).toMatchObject({
        configured: false,
        value: {},
        effectiveValue: { enabled: true, limit: 3 },
        defaults: { enabled: true, limit: 3 },
      });
      expect(configuration?.sections.flatMap((section) => section.fields)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["enabled"], effectiveValue: true }),
          expect.objectContaining({ path: ["limit"], effectiveValue: 3, min: 1 }),
        ]),
      );
    } finally {
      removeDirectory(root);
    }
  });

  test("rejects UI schemas that reference unknown fields or omit declared configuration leaves", () => {
    const root = createTemporaryDirectory("senera-system-extension-invalid-ui");
    try {
      const packageRoot = writeConfigurableExtension(
        root,
        "invalid-ui",
        {
          type: "object",
          properties: {
            limit: { type: "integer", default: 3 },
            mode: { type: "string", default: "safe" },
          },
          additionalProperties: false,
        },
        configurationUi([{ path: ["unknown"], label: "Unknown", type: "string" }]),
      );
      expect(() =>
        new AgentSystemExtensionCatalog().registerRoot(new AgentExtensionRegistry(), root, {
          capabilities: new Set(["shell.run"]),
        }),
      ).toThrow(/references unknown field unknown/u);

      writeJson(
        path.join(packageRoot, "ui.schema.json"),
        configurationUi([{ path: ["limit"], label: "Limit", type: "number" }]),
      );
      expect(() =>
        new AgentSystemExtensionCatalog().registerRoot(new AgentExtensionRegistry(), root, {
          capabilities: new Set(["shell.run"]),
        }),
      ).toThrow(/omits configuration fields: mode/u);
    } finally {
      removeDirectory(root);
    }
  });

  test("validates model selection field shapes and referenced configuration paths", () => {
    const root = createTemporaryDirectory("senera-system-extension-model-selection-ui");
    try {
      const schema = {
        type: "object",
        properties: {
          inheritParent: { type: "boolean", default: true },
          modelProviderIds: { type: "array", items: { type: "string" }, default: [] },
          providerEnabled: { type: "boolean", default: true },
          modelName: { type: "string", default: "" },
        },
        additionalProperties: false,
      };
      const packageRoot = writeConfigurableExtension(
        root,
        "model-selection-ui",
        schema,
        configurationUi([
          { path: ["inheritParent"], label: "Inherit parent", type: "boolean" },
          {
            path: ["modelProviderIds"],
            label: "Model pool",
            type: "array",
            itemType: "string",
            modelSelection: {
              id: "child-model-pool",
              capability: "Chat",
              valueKind: "model-id",
              mutation: "config",
              cardinality: "many",
              inheritance: { source: "parent-model", path: ["modelProviderIds"] },
              required: false,
            },
          },
          { path: ["providerEnabled"], label: "Provider enabled", type: "boolean" },
          { path: ["modelName"], label: "Model name", type: "string" },
        ]),
      );
      const register = () =>
        new AgentSystemExtensionCatalog().registerRoot(new AgentExtensionRegistry(), root, {
          capabilities: new Set(["shell.run"]),
        });

      expect(register).toThrow(/inheritance\.path must reference a boolean field: modelProviderIds/u);

      writeJson(
        path.join(packageRoot, "ui.schema.json"),
        configurationUi([
          { path: ["inheritParent"], label: "Inherit parent", type: "boolean" },
          { path: ["modelProviderIds"], label: "Model pool", type: "array", itemType: "string" },
          { path: ["providerEnabled"], label: "Provider enabled", type: "boolean" },
          {
            path: ["modelName"],
            label: "Model name",
            type: "string",
            modelSelection: {
              id: "invalid-pool",
              capability: "Chat",
              valueKind: "model-id",
              mutation: "config",
              cardinality: "many",
              required: false,
            },
          },
        ]),
      );
      expect(register).toThrow(/modelName has an incompatible many field type/u);
    } finally {
      removeDirectory(root);
    }
  });

  test("rejects legacy string metadata in extension UI schemas", () => {
    const root = createTemporaryDirectory("senera-system-extension-legacy-ui-text");
    try {
      writeConfigurableExtension(
        root,
        "legacy-ui-text",
        {
          type: "object",
          properties: { limit: { type: "integer", default: 3 } },
          additionalProperties: false,
        },
        {
          form: {
            version: 1,
            sections: [
              {
                id: "configuration",
                label: "Configuration",
                fields: [
                  {
                    path: ["limit"],
                    label: "Limit",
                    type: "number",
                    required: false,
                    essential: true,
                  },
                ],
              },
            ],
          },
        },
      );
      expect(() =>
        new AgentSystemExtensionCatalog().registerRoot(new AgentExtensionRegistry(), root, {
          capabilities: new Set(["shell.run"]),
        }),
      ).toThrow();
    } finally {
      removeDirectory(root);
    }
  });

  test("rejects parallel localized metadata fields in extension UI schemas", () => {
    expect(
      LocalizedConfigFormDocumentSchema.safeParse({
        form: {
          version: 1,
          sections: [
            {
              id: "configuration",
              label: localizedTestText("Configuration"),
              localizedLabel: localizedTestText("Legacy configuration"),
              fields: [],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  test("rejects package configuration schemas whose defaults violate their own constraints", () => {
    const root = createTemporaryDirectory("senera-system-extension-invalid-default");
    try {
      writeConfigurableExtension(root, "invalid-default", {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, default: 0 },
        },
        additionalProperties: false,
      });

      expect(() =>
        new AgentSystemExtensionCatalog().registerRoot(new AgentExtensionRegistry(), root, {
          capabilities: new Set(["shell.run"]),
        }),
      ).toThrow(/invalid-default configuration is invalid/u);
    } finally {
      removeDirectory(root);
    }
  });

  test("rejects contract paths that escape a System extension package", () => {
    const root = createTemporaryDirectory("senera-system-extension-path");
    try {
      const packageRoot = createTestPackage(root, "path-test");
      fs.mkdirSync(packageRoot);
      writeJson(path.join(root, "outside.tool.json"), minimalContract("Outside"));
      writeJson(
        path.join(packageRoot, "extension.json"),
        extensionManifest("path-test", "../outside.tool.json", "shell.run"),
      );

      expect(() =>
        new AgentSystemExtensionCatalog().registerRoot(new AgentExtensionRegistry(), root, {
          capabilities: new Set(["shell.run"]),
        }),
      ).toThrow(/must remain inside its extension package/u);
    } finally {
      removeDirectory(root);
    }
  });

  test("rejects host capabilities that are not pre-registered", () => {
    const root = createTemporaryDirectory("senera-system-extension-capability");
    try {
      const packageRoot = createTestPackage(root, "capability-test");
      fs.mkdirSync(path.join(packageRoot, "tools"), { recursive: true });
      writeJson(path.join(packageRoot, "tools", "Test.tool.json"), minimalContract("TestTool"));
      writeJson(
        path.join(packageRoot, "extension.json"),
        extensionManifest("capability-test", "tools/Test.tool.json", "host.module.inject"),
      );

      expect(() =>
        new AgentSystemExtensionCatalog().registerRoot(new AgentExtensionRegistry(), root, {
          capabilities: new Set(["shell.run"]),
        }),
      ).toThrow(/unregistered host capability host\.module\.inject/u);
    } finally {
      removeDirectory(root);
    }
  });
});

function systemToolRegistry(): AgentExtensionRegistry {
  const registry = new AgentExtensionRegistry();
  const definitions = createAgentSystemTools(testConfig());
  new AgentSystemExtensionCatalog().registerRoot(registry, path.resolve("System", "Extensions"), {
    capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]),
  });
  return registry;
}

function testConfig(): AgentSystemConfig {
  return {
    DefaultModelProviderId: "test-model",
    ModelProviderEndpoints: [{ Id: "openai", Enabled: true, BaseUrl: "https://example.test/v1" }],
    ModelProviders: [
      {
        Id: "test-model",
        ProviderId: "openai",
        Endpoint: "ChatCompletions",
        Model: "test-model",
        Capabilities: { Vision: true },
      },
    ],
  };
}

function extensionManifest(id: string, contract: string, capability: string) {
  return {
    schemaVersion: 1,
    id,
    domain: "test",
    settingsSurface: "system-tools",
    version: "1.0.0",
    displayName: { "zh-CN": `${id} 中文`, "en-US": `${id} English` },
    description: { "zh-CN": `${id} 中文描述。`, "en-US": `${id} English description.` },
    contributions: [{ kind: "hostTool", contract, capability }],
  };
}

function minimalContract(name: string) {
  return {
    name,
    loading: "Dynamic",
    description: `${name} test contract.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    permissions: [],
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    runtime: {
      Lifecycle: "Immediate",
      ProtocolVersion: 2,
      ResultAssessment: "ProcessExit",
      Scheduling: "Parallel",
    },
    resources: [],
    sources: [],
    search: {
      Summary: `${name} test tool`,
      Capabilities: [{ Id: `test.${name.toLowerCase()}`, Aliases: [`${name} test`] }],
      UseCases: [`Exercise the ${name} test contract.`],
    },
    evidenceCapabilities: [],
  };
}

function writeConfigurableExtension(
  root: string,
  id: string,
  schema: Record<string, unknown>,
  ui?: Record<string, unknown>,
): string {
  const packageRoot = createTestPackage(root, id);
  fs.mkdirSync(path.join(packageRoot, "tools"), { recursive: true });
  writeJson(path.join(packageRoot, "tools", "Test.tool.json"), minimalContract("TestTool"));
  writeJson(path.join(packageRoot, "config.schema.json"), schema);
  if (ui) writeJson(path.join(packageRoot, "ui.schema.json"), ui);
  writeJson(path.join(packageRoot, "extension.json"), {
    ...extensionManifest(id, "tools/Test.tool.json", "shell.run"),
    configuration: {
      schema: "config.schema.json",
      ...(ui ? { ui: "ui.schema.json" } : {}),
    },
  });
  return packageRoot;
}

function createTestPackage(root: string, id: string): string {
  const domainRoot = path.join(root, "test");
  fs.mkdirSync(domainRoot, { recursive: true });
  const domainPath = path.join(domainRoot, "domain.json");
  if (!fs.existsSync(domainPath)) {
    writeJson(domainPath, {
      schemaVersion: 1,
      id: "test",
      displayName: localizedTestText("Test domain"),
      description: localizedTestText("Test System extension domain."),
      presentation: {
        category: "test",
        icon: "tools",
        group: { id: "test", title: localizedTestText("Test tools") },
        activity: { action: localizedTestText("Test") },
      },
    });
  }
  return path.join(domainRoot, id);
}

function configurationUi(fields: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    form: {
      version: 1,
      sections: [
        {
          id: "configuration",
          label: localizedTestText("Configuration"),
          fields: fields.map((field) => ({
            required: false,
            essential: true,
            ...field,
            label: localizedTestText(String(field.label)),
          })),
        },
      ],
    },
  };
}

function localizedTestText(value: string): Record<"zh-CN" | "en-US", string> {
  return { "zh-CN": value, "en-US": value };
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}
