import assert from "node:assert/strict";
import { AgentSystemConfigSchema } from "../Source/AgentSystem/Schemas/AgentSystemConfigSchema.js";
import { resolveModelProviderConfig } from "../Source/AgentSystem/AgentDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types.js";

const baseConfig = {
  PluginRoots: {
    System: ["./System/Plugins"],
    User: ["./Plugins"],
  },
  PluginDiscovery: {
    ManifestFileName: "PluginManifest.json",
  },
  XmlProtocol: {
    MaxDepth: 16,
    MaxDecisionTokens: 32000,
    MaxToolCalls: 8,
  },
  ToolExecution: {
    Mode: "Process",
    TimeoutMs: 1000,
    MaxStdoutBytes: 1000,
    MaxStderrBytes: 1000,
  },
  ModelProviders: [{
    Id: "test",
    Kind: "OpenAICompatible",
    Endpoint: "Responses",
    BaseUrl: "https://example.test/v1",
    ApiKey: "test",
    Model: "test-model",
    Temperature: 0.2,
    MaxOutputTokens: -1,
    Stream: true,
    TimeoutMs: 1000,
    MaxNetworkRetries: 0,
  }],
} satisfies AgentSystemConfig;

function parseConfig(config: AgentSystemConfig): AgentSystemConfig {
  return AgentSystemConfigSchema.parse(config);
}

const defaulted = resolveModelProviderConfig(parseConfig(baseConfig));
assert.equal(defaulted.FirstTokenTimeoutMs, -1);
assert.equal(defaulted.MaxRequestMs, -1);

const configured = resolveModelProviderConfig(parseConfig({
  ...baseConfig,
  ModelProviders: [{
    ...baseConfig.ModelProviders[0],
    FirstTokenTimeoutMs: 5000,
    MaxRequestMs: 180000,
  }],
}));
assert.equal(configured.FirstTokenTimeoutMs, 5000);
assert.equal(configured.MaxRequestMs, 180000);

assert.throws(() => parseConfig({
  ...baseConfig,
  ModelProviders: [{
    ...baseConfig.ModelProviders[0],
    FirstTokenTimeoutMs: 0,
  }],
}));

assert.throws(() => parseConfig({
  ...baseConfig,
  ModelProviders: [{
    ...baseConfig.ModelProviders[0],
    MaxRequestMs: 0,
  }],
}));

console.log("Model timeout config verification passed.");
