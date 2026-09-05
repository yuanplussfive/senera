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
import { AgentSystemExtensionCatalog } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolSource.js";
import { createAgentSystemTools } from "../../../Source/AgentSystem/SystemTools/AgentSystemTools.js";
import { LearningManageSystemTool } from "../../../Source/AgentSystem/SystemTools/LearningManageSystemTool.js";
import { AgentToolHostCapabilityRegistry } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import {
  AgentHostCapabilityNames,
  listDefaultAgentHostCapabilityNames,
} from "../../../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { StandardAgentToolObservationProjection } from "../../../Source/AgentSystem/ToolRuntime/AgentToolObservationProjectionPlan.js";
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
      handler: { kind: "HostCapability", capability: "workspace.apply_patch" },
      contract: { outputSchema: undefined },
    });
    expect(registry.getTool("WorkspaceInspectTool")).toBeUndefined();
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
    expect(registry.listTools().every((tool) => tool.loading === "Bootstrap")).toBe(true);
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
      expect(tool.observationProjection).toMatchObject({
        schemaVersion: 2,
        artifactFallback: { strategy: "reference" },
      });
      expect(tool.observationProjection?.sources.length).toBeGreaterThan(0);
    }
    expect(registry.getTool("ExecutionResourceInspect")?.observationProjection?.continuation).toMatchObject({
      kind: "cursor",
      handle: "/resourceId",
      cursor: "/cursor",
    });

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

  test("rejects extension packages with incomplete localized metadata", () => {
    const root = createTemporaryDirectory("senera-system-extension-localization");
    try {
      const packageRoot = path.join(root, "incomplete-localization");
      fs.mkdirSync(path.join(packageRoot, "tools"), { recursive: true });
      writeObservationProjection(packageRoot);
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
              id: "provider-model",
              capability: "Chat",
              valueKind: "provider-model",
              mutation: "config",
              providerPath: ["providerEnabled"],
              required: false,
            },
          },
        ]),
      );
      expect(register).toThrow(/providerPath must reference a string field: providerEnabled/u);

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

  test("reports an empty observable learning ledger from a new workspace", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-learning-manage");
    try {
      const output = await LearningManageSystemTool.execute({ action: "status" }, {
        workspaceRoot,
        config: testConfig(),
      } as AgentHostToolContext);

      expect(output).toMatchObject({ action: "status", episodeCount: 0, episodeGroups: [], skillTermCount: 0 });
    } finally {
      removeDirectory(workspaceRoot);
    }
  });

  test("rejects contract paths that escape a System extension package", () => {
    const root = createTemporaryDirectory("senera-system-extension-path");
    try {
      const packageRoot = path.join(root, "path-test");
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

  test("rejects observation projection paths that escape their extension package", () => {
    const root = createTemporaryDirectory("senera-system-observation-path");
    try {
      const packageRoot = path.join(root, "path-test");
      fs.mkdirSync(path.join(packageRoot, "tools"), { recursive: true });
      writeJson(path.join(root, "outside.projection.json"), StandardAgentToolObservationProjection);
      writeJson(path.join(packageRoot, "tools", "Test.tool.json"), {
        ...minimalContract("TestTool"),
        observationProjection: "../outside.projection.json",
      });
      writeJson(
        path.join(packageRoot, "extension.json"),
        extensionManifest("path-test", "tools/Test.tool.json", "shell.run"),
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

  test("includes the external observation projection in the registered contract digest", () => {
    const root = createTemporaryDirectory("senera-system-observation-digest");
    try {
      const packageRoot = path.join(root, "digest-test");
      fs.mkdirSync(path.join(packageRoot, "tools"), { recursive: true });
      writeObservationProjection(packageRoot);
      writeJson(path.join(packageRoot, "tools", "Test.tool.json"), minimalContract("TestTool"));
      writeJson(
        path.join(packageRoot, "extension.json"),
        extensionManifest("digest-test", "tools/Test.tool.json", "shell.run"),
      );
      const firstRegistry = new AgentExtensionRegistry();
      new AgentSystemExtensionCatalog().registerRoot(firstRegistry, root, { capabilities: new Set(["shell.run"]) });
      const firstDigest = firstRegistry.getTool("TestTool")?.contract?.digest;

      writeJson(path.join(packageRoot, "observations", "default.projection.json"), {
        ...StandardAgentToolObservationProjection,
        maxTokens: StandardAgentToolObservationProjection.maxTokens + 1,
      });
      const secondRegistry = new AgentExtensionRegistry();
      new AgentSystemExtensionCatalog().registerRoot(secondRegistry, root, { capabilities: new Set(["shell.run"]) });

      expect(secondRegistry.getTool("TestTool")?.contract?.digest).not.toBe(firstDigest);
    } finally {
      removeDirectory(root);
    }
  });

  test("rejects host capabilities that are not pre-registered", () => {
    const root = createTemporaryDirectory("senera-system-extension-capability");
    try {
      const packageRoot = path.join(root, "capability-test");
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
    version: "1.0.0",
    displayName: { "zh-CN": `${id} 中文`, "en-US": `${id} English` },
    description: { "zh-CN": `${id} 中文描述。`, "en-US": `${id} English description.` },
    contributions: [{ kind: "hostTool", contract, capability }],
  };
}

function minimalContract(name: string) {
  return {
    name,
    observationProjection: "observations/default.projection.json",
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
      Capabilities: [{ Id: `test.${name.toLowerCase()}` }],
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
  const packageRoot = path.join(root, id);
  fs.mkdirSync(path.join(packageRoot, "tools"), { recursive: true });
  writeObservationProjection(packageRoot);
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

function writeObservationProjection(packageRoot: string): void {
  const directory = path.join(packageRoot, "observations");
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, "default.projection.json"), StandardAgentToolObservationProjection);
}
