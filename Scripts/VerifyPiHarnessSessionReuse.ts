import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AgentJsonFileLoader } from "../Source/AgentSystem/Config/AgentJsonFileLoader.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentPiSubstrate } from "../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { AgentToolCallExecutor } from "../Source/AgentSystem/ToolRuntime/AgentToolCallExecutor.js";
import { createXmlProtocolSpec } from "../Source/AgentSystem/Xml/AgentXmlPolicy.js";
import { AgentToolExecutionArtifactRecorder } from "../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { resolveArtifactsConfig } from "../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import { PluginManifestSchema } from "../Source/AgentSystem/Schemas/PluginManifestSchema.js";
import { SeneraLocalExecutionEnv } from "../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type { AgentDomainEvent } from "../Source/AgentSystem/Events/AgentEvent.js";
import type {
  AgentSystemConfig,
  ResolvedAgentModelProviderConfig,
} from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { PluginManifest } from "../Source/AgentSystem/Types/PluginManifestTypes.js";

const sessionsRoot = createTemporarySessionsRoot("harness-reuse");
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
  Temperature: 0,
  MaxOutputTokens: -1,
  Stream: true,
  TimeoutMs: 20_000,
  FirstTokenTimeoutMs: 20_000,
  MaxRequestMs: 20_000,
  MaxNetworkRetries: 1,
  Headers: {},
};

const registry = new AgentPluginRegistry();
registerPlugin(registry, "System/Plugins/AgentCapabilitySkillsPlugin");

const executionEnv = new SeneraLocalExecutionEnv({
  workspaceRoot: process.cwd(),
});
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

const sessionId = `verify-pi-harness-reuse-${randomUUID()}`;
const events: AgentDomainEvent[] = [];
const first = await substrate.leaseTurn({
  sessionId,
  requestId: "verify-pi-harness-reuse-1",
  step: 1,
  input: "第一次请求",
  systemPrompt: "<agent_system>first</agent_system>",
  visibleToolNames: [],
  onEvent: (event) => {
    events.push(event);
  },
});
first.session.dispose();

const second = await substrate.leaseTurn({
  sessionId,
  requestId: "verify-pi-harness-reuse-2",
  step: 1,
  input: "第二次请求",
  systemPrompt: "<agent_system>second</agent_system>",
  visibleToolNames: [],
  onEvent: (event) => {
    events.push(event);
  },
});
second.session.dispose();
await substrate.close();

assert.equal(first.piSessionId, sessionId);
assert.equal(second.piSessionId, sessionId);
assert.equal(first.historyMigrationRequired, true);
assert.deepEqual(
  tracePayloads(events, "core.turn.lease.completed").map((payload) => payload.harnessStorage),
  ["created", "existing"],
);
assert.deepEqual(
  tracePayloads(events, "core.turn.lease.completed").map((payload) => payload.piSessionStorage),
  ["created", "existing"],
);
assert.deepEqual(
  tracePayloads(events, "core.turn.lease.completed").map((payload) => payload.piSessionId),
  [sessionId, sessionId],
);

console.log("Pi harness session reuse verification passed.");

function createTemporarySessionsRoot(name: string): string {
  const parent = path.resolve(".senera/tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, `verify-${name}-`));
  process.once("exit", () => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function tracePayloads(events: readonly AgentDomainEvent[], eventType: string): Record<string, unknown>[] {
  return events.flatMap((event) => {
    const data = readRecord(event.data);
    if (event.kind !== "pi.trace" || data.eventType !== eventType) {
      return [];
    }
    return [readRecord(data.payload)];
  });
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
