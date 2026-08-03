import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyAgentToolAccessGrant } from "../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import fs from "node:fs";
import path from "node:path";
import { AgentExtensionRegistry } from "../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentPiSubstrate } from "../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { AgentToolCallExecutor } from "../Source/AgentSystem/ToolRuntime/AgentToolCallExecutor.js";
import { createXmlProtocolSpec } from "../Source/AgentSystem/Xml/AgentXmlPolicy.js";
import { AgentToolExecutionArtifactRecorder } from "../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { resolveArtifactsConfig } from "../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import { SeneraLocalExecutionEnv } from "../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type { AgentPiDiagnosticEvent } from "../Source/AgentSystem/Pi/AgentPiDiagnostics.js";
import type {
  AgentSystemConfig,
  ResolvedAgentModelProviderConfig,
} from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentPiTurnContextRegistry } from "../Source/AgentSystem/PiShared/AgentPiTurnContext.js";

const sessionsRoot = createTemporarySessionsRoot("coding-agent-reuse");
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
};

const registry = new AgentExtensionRegistry();

const executionEnv = new SeneraLocalExecutionEnv({
  workspaceRoot: process.cwd(),
});
const diagnostics: AgentPiDiagnosticEvent[] = [];
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

const sessionId = `verify-pi-coding-agent-reuse-${randomUUID()}`;
const first = await substrate.leaseTurn({
  sessionId,
  requestId: "verify-pi-coding-agent-reuse-1",
  step: 1,
  input: "第一次请求",
  systemPrompt: "<agent_system>first</agent_system>",
  visibleToolNames: [],
  toolAccessGrant: emptyAgentToolAccessGrant(),
});
first.session.dispose();

const second = await substrate.leaseTurn({
  sessionId,
  requestId: "verify-pi-coding-agent-reuse-2",
  step: 1,
  input: "第二次请求",
  systemPrompt: "<agent_system>second</agent_system>",
  visibleToolNames: [],
  toolAccessGrant: emptyAgentToolAccessGrant(),
});
second.session.dispose();
await substrate.close();

assert.equal(first.piSessionId, sessionId);
assert.equal(second.piSessionId, sessionId);
assert.equal(first.historyMigrationRequired, true);
assert.deepEqual(
  diagnosticDetails(diagnostics, "core.turn.lease.completed").map((details) => details.sessionStorage),
  ["created", "existing"],
);
assert.deepEqual(
  diagnosticDetails(diagnostics, "core.turn.lease.completed").map((details) => details.piSessionId),
  [sessionId, sessionId],
);

console.log("Pi Coding Agent session reuse verification passed.");

function createTemporarySessionsRoot(name: string): string {
  const parent = path.resolve(".senera/tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, `verify-${name}-`));
  process.once("exit", () => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function diagnosticDetails(events: readonly AgentPiDiagnosticEvent[], name: string): Record<string, unknown>[] {
  return events.filter((event) => event.name === name).map((event) => readRecord(event.details));
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
