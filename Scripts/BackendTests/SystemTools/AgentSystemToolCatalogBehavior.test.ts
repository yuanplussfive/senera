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
import { listDefaultAgentHostCapabilityNames } from "../../../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { StandardAgentToolObservationProjection } from "../../../Source/AgentSystem/ToolRuntime/AgentToolObservationProjectionPlan.js";

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

    expect(registry.listTools()).toHaveLength(19);
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
    expect(registry.getTool("TavilySearchTool")).toBeUndefined();
    for (const tool of registry.listTools()) {
      expect(tool.observationProjection).toMatchObject({
        schemaVersion: 1,
        artifactFallback: { strategy: "reference" },
      });
      expect(tool.observationProjection?.sources.length).toBeGreaterThan(0);
    }
    expect(registry.getTool("ExecutionResourceInspect")?.observationProjection?.continuation).toMatchObject({
      kind: "cursor",
      handle: "/resourceId",
      cursor: "/cursor",
    });

    const extensions = catalog.listExtensions();
    expect(extensions).toHaveLength(12);
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
    expect(registry.listTools()).toHaveLength(18);
    const extension = catalog.listExtensions().find((item) => item.id === "agent-document-tools");
    expect(extension).toMatchObject({ enabled: false, configured: true, tools: [{ name: "DocumentExtract" }] });
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
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, ResultAssessment: "ProcessExit" },
    resources: [],
    sources: [],
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
