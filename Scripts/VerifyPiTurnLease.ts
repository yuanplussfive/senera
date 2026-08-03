import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentToolExecutionArtifactRecorder } from "../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { AgentExtensionRegistry } from "../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentPiSubstrate } from "../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { createXmlProtocolSpec } from "../Source/AgentSystem/Xml/AgentXmlPolicy.js";
import { AgentToolCallExecutor } from "../Source/AgentSystem/ToolRuntime/AgentToolCallExecutor.js";
import { resolveArtifactsConfig } from "../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import type {
  AgentSystemConfig,
  ResolvedAgentModelProviderConfig,
} from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { emptyAgentToolAccessGrant } from "../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentSkillScanner } from "../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { SeneraLocalExecutionEnv } from "../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type { AgentPiDiagnosticEvent } from "../Source/AgentSystem/Pi/AgentPiDiagnostics.js";
import { AgentPiTurnContextRegistry } from "../Source/AgentSystem/PiShared/AgentPiTurnContext.js";

const sessionsRoot = createTemporarySessionsRoot("turn-lease");
const config: AgentSystemConfig = {
  Server: {
    Host: "127.0.0.1",
    Port: 8787,
  },
  DefaultModelProviderId: "verification-model",
  AgentLoop: {
    PiSessions: {
      RootDir: sessionsRoot,
    },
  },
  ModelProviderEndpoints: [
    {
      Id: "verification-provider",
      BaseUrl: "https://example.invalid/v1",
      ApiKey: "verification-key",
    },
  ],
  ModelProviders: [
    {
      Id: "verification-model",
      ProviderId: "verification-provider",
      Endpoint: "ChatCompletions",
      Model: "verification-model",
    },
  ],
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
  ContextWindowTokens: 128_000,
  Temperature: 0,
  MaxOutputTokens: -1,
  Stream: true,
  TimeoutMs: 20_000,
  FirstTokenTimeoutMs: 20_000,
  MaxRequestMs: 20_000,
  MaxNetworkRetries: 1,
  RetryBaseDelayMs: 250,
  RetryMaxDelayMs: 10_000,
  RetryAfterMaxDelayMs: 60_000,
  Headers: {},
  Capabilities: {},
};

const diagnostics: AgentPiDiagnosticEvent[] = [];
const registry = new AgentExtensionRegistry();
const registeredSkill = new AgentSkillScanner().readSkillDirectory(
  path.resolve("System/Skills/workspace-investigation"),
  "workspace-investigation",
);
registry.registerSkill({
  ...registeredSkill,
  source: { kind: "system", id: registeredSkill.name, displayName: "Senera" },
});
const executionEnv = new SeneraLocalExecutionEnv({
  workspaceRoot: process.cwd(),
});
const activeSkills = [
  {
    name: "workspace-investigation",
    revision: "test-revision",
    title: "工作区调查",
    summary: "确认 Senera 激活技能能进入 Pi Harness 资源。",
    useCases: ["验证 Pi 会话启动"],
    avoid: [],
    recommendedTools: [],
    evidenceRequirements: [],
    descriptionFile: path.resolve("System/Skills/workspace-investigation/SKILL.md"),
    matchedTerms: ["lease"],
    matchedFields: [
      {
        term: "lease",
        fields: ["summary"],
      },
    ],
    score: 1,
  },
];
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
  diagnostics: (event) => {
    diagnostics.push(event);
  },
  turnContexts: new AgentPiTurnContextRegistry(),
});

const result = await withTimeout(
  substrate.leaseTurn({
    requestId: "verify-pi-turn-lease",
    step: 1,
    input: "请继续全面优化拓展代码并运行测试验证直到完成",
    systemPrompt: "<agent_system></agent_system>",
    visibleToolNames: [],
    toolAccessGrant: emptyAgentToolAccessGrant(),
    activeSkills,
  }),
);

assert.equal(result.session.model?.id, modelProvider.Model);
assert.deepEqual(result.session.getActiveToolNames(), []);
assert.equal(hasDiagnostic("core.turn.lease.started"), true);
assert.equal(hasDiagnostic("core.turn.lease.completed"), true);
assert.deepEqual(diagnosticDetails("core.turn.lease.completed")?.skillNames, ["workspace-investigation"]);
assert.deepEqual(readStringArray(diagnosticDetails("core.turn.lease.completed")?.promptTemplateNames), []);
assert.deepEqual(readStringArray(diagnosticDetails("core.turn.lease.completed")?.selectedPromptTemplateNames), []);
assert.equal(
  substrate.toolDefinitions().every((tool) => tool.executionMode === "parallel"),
  true,
);
result.session.dispose();

console.log("Pi turn lease verification passed.");

function createTemporarySessionsRoot(name: string): string {
  const parent = path.resolve(".senera/tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, `verify-${name}-`));
  process.once("exit", () => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function hasDiagnostic(name: string): boolean {
  return diagnostics.some((event) => event.name === name);
}

function diagnosticDetails(name: string): Record<string, unknown> | undefined {
  const details = diagnostics.find((event) => event.name === name)?.details;
  return details === undefined ? undefined : readRecord(details);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  const timeoutMs = 15_000;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Pi turn lease timed out after ${timeoutMs}ms.`));
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
