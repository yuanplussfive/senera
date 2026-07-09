import assert from "node:assert/strict";
import path from "node:path";
import { AgentToolExecutionArtifactRecorder } from "../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { AgentJsonFileLoader } from "../Source/AgentSystem/Config/AgentJsonFileLoader.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentPiSubstrate } from "../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { createXmlProtocolSpec } from "../Source/AgentSystem/Xml/AgentXmlPolicy.js";
import { AgentToolCallExecutor } from "../Source/AgentSystem/ToolRuntime/AgentToolCallExecutor.js";
import { resolveArtifactsConfig } from "../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import { PluginManifestSchema } from "../Source/AgentSystem/Schemas/PluginManifestSchema.js";
import type {
  AgentSystemConfig,
  ResolvedAgentModelProviderConfig,
} from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { PluginManifest } from "../Source/AgentSystem/Types/PluginManifestTypes.js";
import { AgentPiResourceProjector } from "../Source/AgentSystem/Pi/AgentPiResourceProjector.js";
import {
  projectSelectedPromptTemplateFrame,
  renderPiHarnessSystemPrompt,
} from "../Source/AgentSystem/Pi/AgentPiPromptFrameProjector.js";
import { SeneraLocalExecutionEnv } from "../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";

const config: AgentSystemConfig = {
  Server: {
    Host: "127.0.0.1",
    Port: 8787,
  },
  DefaultModelProviderId: "verification-model",
  ModelProviderEndpoints: [{
    Id: "verification-provider",
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "verification-key",
  }],
  ModelProviders: [{
    Id: "verification-model",
    ProviderId: "verification-provider",
    Endpoint: "ChatCompletions",
    Model: "verification-model",
  }],
};

const modelProvider: ResolvedAgentModelProviderConfig = {
  Id: "verification-model",
  ProviderId: "verification-provider",
  Kind: "OpenAICompatible",
  Endpoint: "ChatCompletions",
  BaseUrl: "https://example.invalid/v1",
  ApiKey: "verification-key",
  ApiVersion: "",
  Model: "verification-model",
  Temperature: 0,
  MaxOutputTokens: -1,
  Stream: true,
  TimeoutMs: 20_000,
  FirstTokenTimeoutMs: 20_000,
  MaxRequestMs: 20_000,
  MaxNetworkRetries: 1,
  Headers: {},
  Capabilities: {
    ToolCalling: true,
  },
};

const events: unknown[] = [];
const registry = new AgentPluginRegistry();
registerPlugin(registry, "System/Plugins/AgentCapabilitySkillsPlugin");
const executionEnv = new SeneraLocalExecutionEnv({
  workspaceRoot: process.cwd(),
});
const activeSkills = [{
  name: "WorkspaceInvestigationSkill",
  title: "工作区调查",
  summary: "确认 Senera 激活技能能进入 Pi Harness 资源。",
  useCases: ["验证 Pi 会话启动"],
  avoid: [],
  recommendedTools: [],
  evidenceRequirements: [],
  descriptionFile: path.resolve("System/Plugins/AgentCapabilitySkillsPlugin/docs/WorkspaceInvestigation.md"),
  matchedTerms: ["bootstrap"],
  matchedFields: [{
    term: "bootstrap",
    fields: ["summary"],
  }],
  score: 1,
}];
const substrate = new AgentPiSubstrate({
  workspaceRoot: process.cwd(),
  config,
  modelProvider,
  registry,
  toolCallExecutor: new AgentToolCallExecutor({
    registry,
    config,
    protocol: createXmlProtocolSpec(config),
    workspaceRoot: process.cwd(),
    executionEnv,
    emitLifecycleEvents: false,
  }),
  artifactRecorder: new AgentToolExecutionArtifactRecorder({
    workspaceRoot: process.cwd(),
    config: resolveArtifactsConfig(config),
    model: modelProvider.Model,
  }),
  executionEnv,
});

const result = await withTimeout(
  substrate.createSession({
    requestId: "verify-pi-session-bootstrap",
    step: 1,
    input: "请继续全面优化拓展代码并运行测试验证直到完成",
    systemPrompt: "<agent_system></agent_system>",
    visibleToolNames: [],
    activeSkills,
    onEvent: (event) => {
      events.push(event);
    },
  }),
);

const resourceProjector = new AgentPiResourceProjector(registry);
const resources = resourceProjector.project({
  input: "请继续全面优化拓展代码并运行测试验证直到完成",
  activeSkills,
});
assert.equal(result.session.model?.id, modelProvider.Model);
assert.deepEqual(result.session.getActiveToolNames(), []);
await result.session.setResources({
  skills: resources.harnessResources.skills,
  promptTemplates: resources.harnessResources.promptTemplates,
});
assert.equal(hasPiTraceEvent("core.agent.create.started"), true);
assert.equal(hasPiTraceEvent("core.agent.create.completed"), true);
assert.deepEqual(piTracePayload("core.agent.create.completed")?.skillNames, ["WorkspaceInvestigationSkill"]);
assertContainsAll(readStringArray(piTracePayload("core.agent.create.completed")?.promptTemplateNames), [
  "TddExecution",
  "TodoWorkflow",
  "ImplementationWorkflow",
]);
assertContainsAll(readStringArray(piTracePayload("core.agent.create.completed")?.selectedPromptTemplateNames), [
  "TddExecution",
  "TodoWorkflow",
  "ImplementationWorkflow",
]);
assert.equal(
  readSelectedTemplatePayloads("core.agent.create.completed")
    .some((template) => readStringArray(template.resourceKinds).includes("todo-workflow")),
  true,
);
const projectedSkill = resources.harnessResources.skills?.[0];
assert.match(projectedSkill?.content ?? "", /WorkspaceInvestigationSkill/);
const projectedTemplateByName = new Map(
  resources.harnessResources.promptTemplates?.map((template) => [template.name, template]) ?? [],
);
assert.match(projectedTemplateByName.get("TddExecution")?.content ?? "", /Execution contract/);
assertContainsAll(resources.selection.promptTemplates.map((selection) => selection.template.name), [
  "TddExecution",
  "TodoWorkflow",
  "ImplementationWorkflow",
]);
const prompt = renderPiHarnessSystemPrompt({
  systemPrompt: "<agent_system></agent_system>",
  skills: [projectedSkill!],
  selectedPromptTemplates: resources.selection.promptTemplates.map((selection) =>
    projectSelectedPromptTemplateFrame({
      template: resourceProjector.projectPromptTemplate(selection.template),
      matchedTerms: selection.matchedTerms,
      objective: "请继续全面优化拓展代码并运行测试验证直到完成",
      resourceKinds: selection.resourceKinds,
      workflowRoles: selection.workflowRoles,
      selectionScore: selection.score,
    })),
});
assert.match(prompt, /WorkspaceInvestigationSkill/);
assert.match(prompt, /pi_execution_resources/);
assert.match(prompt, /todo-workflow/);
assert.match(prompt, /implementation-workflow/);
assert.match(prompt, /Execution contract/);
assert.equal(
  substrate.toolDefinitions({
    visibleToolNames: "all",
  }).every((tool) => tool.executionMode === "sequential"),
  true,
);
result.session.dispose();

console.log("Pi session bootstrap verification passed.");

function hasPiTraceEvent(eventType: string): boolean {
  return events.some((event) => {
    const record = readRecord(event);
    const data = readRecord(record.data);
    return record.kind === "pi.trace" && data.eventType === eventType;
  });
}

function piTracePayload(eventType: string): Record<string, unknown> | undefined {
  const event = events.find((candidate) => {
    const record = readRecord(candidate);
    const data = readRecord(record.data);
    return record.kind === "pi.trace" && data.eventType === eventType;
  });
  return readRecord(readRecord(readRecord(event).data).payload);
}

function readSelectedTemplatePayloads(eventType: string): Record<string, unknown>[] {
  const templates = piTracePayload(eventType)?.selectedPromptTemplates;
  return Array.isArray(templates)
    ? templates.map(readRecord)
    : [];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function assertContainsAll(actual: readonly string[], expected: readonly string[]): void {
  assert.deepEqual(
    expected.filter((item) => !actual.includes(item)),
    [],
  );
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  const timeoutMs = 15_000;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Pi session bootstrap timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function registerPlugin(registry: AgentPluginRegistry, relativeRootPath: string): void {
  const rootPath = path.resolve(relativeRootPath);
  const manifestPath = path.join(rootPath, "PluginManifest.json");
  registry.registerPlugin({
    rootPath,
    rootKind: "System",
    manifestPath,
    config: {
      fileName: "PluginConfig.toml",
      path: path.join(rootPath, "PluginConfig.toml"),
      exists: false,
      source: "default",
      templateExists: false,
      needsUserConfig: false,
      toml: "",
      sections: [],
      runtime: {
        enabled: true,
        tools: {},
      },
      diagnostics: [],
    },
    manifest: new AgentJsonFileLoader().load(manifestPath, PluginManifestSchema) as PluginManifest,
  });
}
