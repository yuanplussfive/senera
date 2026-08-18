import { describe, expect, it } from "vitest";
import {
  redactAgentConfigSnapshotSecrets,
  redactAgentSystemConfigSecrets,
  restoreAgentProviderEndpointSecrets,
  restoreAgentSystemConfigSecrets,
} from "../../../Source/AgentSystem/Config/AgentConfigSecretRedaction.js";
import { AgentConfigSecretContract } from "../../../Source/AgentSystem/Config/AgentConfigSecretContract.js";
import { projectAgentConfigForm } from "../../../Source/AgentSystem/Config/AgentConfigFormProjector.js";
import type { AgentConfigSnapshot } from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

const Placeholder = AgentConfigSecretContract.RedactedPlaceholder;

function configFixture(): AgentSystemConfig {
  return {
    ModelProviderEndpoints: [
      {
        Id: "openai",
        BaseUrl: "https://example.invalid/v1",
        ApiKey: "sk-live-secret",
        Headers: {
          Authorization: "Bearer raw-token",
          "x-api-key": "raw-header-key",
          "HTTP-Referer": "https://senera.example",
        },
      },
      { Id: "keyless", BaseUrl: "https://example.invalid/v1", ApiKey: "" },
    ],
    ModelProviders: [{ Id: "model", ProviderId: "openai", Endpoint: "ChatCompletions", Model: "test-model" }],
  };
}

describe("config secret redaction", () => {
  it("masks api keys and credential-bearing headers while keeping benign headers readable", () => {
    const redacted = redactAgentSystemConfigSecrets(configFixture());
    const [endpoint, keyless] = redacted.ModelProviderEndpoints ?? [];
    expect(endpoint?.ApiKey).toBe(Placeholder);
    expect(endpoint?.Headers).toEqual({
      Authorization: Placeholder,
      "x-api-key": Placeholder,
      "HTTP-Referer": "https://senera.example",
    });
    expect(keyless?.ApiKey).toBe("");
  });

  it("does not mutate the source config", () => {
    const config = configFixture();
    redactAgentSystemConfigSecrets(config);
    expect(config.ModelProviderEndpoints?.[0]?.ApiKey).toBe("sk-live-secret");
    expect(config.ModelProviderEndpoints?.[0]?.Headers?.Authorization).toBe("Bearer raw-token");
  });

  it("redacts extension configuration secrets recursively and restores them on full updates", () => {
    const baseline: AgentSystemConfig = {
      ModelProviders: [],
      Extensions: {
        "web-tools": {
          Enabled: true,
          Configuration: {
            search: {
              exaApiKey: "exa-live-secret",
              tavilyApiKey: "tavily-live-secret",
              endpoint: "https://search.example",
            },
            connection: { clientSecret: "nested-live-secret" },
          },
        },
      },
    };

    const redacted = redactAgentSystemConfigSecrets(baseline);
    const configuration = redacted.Extensions?.["web-tools"]?.Configuration;
    expect(configuration).toMatchObject({
      search: {
        exaApiKey: Placeholder,
        tavilyApiKey: Placeholder,
        endpoint: "https://search.example",
      },
      connection: { clientSecret: Placeholder },
    });
    expect(JSON.stringify(redacted)).not.toContain("live-secret");
    expect(JSON.stringify(baseline)).toContain("exa-live-secret");

    const restored = restoreAgentSystemConfigSecrets(redacted, baseline);
    expect(restored).toEqual(baseline);
  });

  it("keeps replacement extension configuration secrets while restoring unchanged placeholders", () => {
    const baseline: AgentSystemConfig = {
      ModelProviders: [],
      Extensions: {
        "web-tools": {
          Configuration: { search: { exaApiKey: "old-secret", endpoint: "https://search.example" } },
        },
      },
    };
    const edited = redactAgentSystemConfigSecrets(baseline);
    const search = edited.Extensions?.["web-tools"]?.Configuration?.search as Record<string, unknown>;
    search.exaApiKey = "rotated-secret";

    const restored = restoreAgentSystemConfigSecrets(edited, baseline);
    expect(restored.Extensions?.["web-tools"]?.Configuration).toEqual({
      search: { exaApiKey: "rotated-secret", endpoint: "https://search.example" },
    });
  });

  it("returns the same reference when there is nothing to redact", () => {
    const config: AgentSystemConfig = { ModelProviders: [] };
    expect(redactAgentSystemConfigSecrets(config)).toBe(config);
  });

  it("restores placeholders from the stored baseline on round-trip", () => {
    const baseline = configFixture();
    const restored = restoreAgentSystemConfigSecrets(redactAgentSystemConfigSecrets(baseline), baseline);
    expect(restored).toEqual(baseline);
  });

  it("keeps user-entered replacement values untouched", () => {
    const baseline = configFixture();
    const edited = redactAgentSystemConfigSecrets(baseline);
    const endpoint = edited.ModelProviderEndpoints?.[0];
    if (!endpoint) throw new Error("fixture endpoint missing");
    endpoint.ApiKey = "sk-rotated";
    const restored = restoreAgentSystemConfigSecrets(edited, baseline);
    expect(restored.ModelProviderEndpoints?.[0]?.ApiKey).toBe("sk-rotated");
    expect(restored.ModelProviderEndpoints?.[0]?.Headers?.Authorization).toBe("Bearer raw-token");
  });

  it("rejects placeholders that no longer match a stored endpoint", () => {
    const baseline = configFixture();
    const edited = redactAgentSystemConfigSecrets(baseline);
    const endpoint = edited.ModelProviderEndpoints?.[0];
    if (!endpoint) throw new Error("fixture endpoint missing");
    endpoint.Id = "renamed";
    expect(() => restoreAgentSystemConfigSecrets(edited, baseline)).toThrowError(/renamed/);
  });

  it("rejects placeholder header values whose header was renamed", () => {
    const baseline = configFixture();
    const edited = redactAgentSystemConfigSecrets(baseline);
    const headers = edited.ModelProviderEndpoints?.[0]?.Headers;
    if (!headers) throw new Error("fixture headers missing");
    headers["X-Renamed-Auth"] = headers.Authorization;
    delete headers.Authorization;
    expect(() => restoreAgentSystemConfigSecrets(edited, baseline)).toThrowError(/X-Renamed-Auth/);
  });

  it("restores endpoint patches used by provider.endpoint.upsert", () => {
    const baseline = configFixture();
    const restored = restoreAgentProviderEndpointSecrets(
      { Id: "openai", ApiKey: Placeholder, BaseUrl: "https://changed.invalid/v1" },
      baseline.ModelProviderEndpoints ?? [],
    );
    expect(restored).toEqual({
      Id: "openai",
      ApiKey: "sk-live-secret",
      BaseUrl: "https://changed.invalid/v1",
    });
  });

  it("redacts snapshot value and re-projected form without leaking plaintext", () => {
    const value = configFixture();
    const snapshot: AgentConfigSnapshot = {
      path: "senera.config.json",
      version: 1,
      value,
      source: "json",
      diagnostics: [],
      form: projectAgentConfigForm(value),
    };
    const redacted = redactAgentConfigSnapshotSecrets(snapshot);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("sk-live-secret");
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("raw-header-key");
    expect(serialized).toContain("https://senera.example");
    expect(JSON.stringify(snapshot.value)).toContain("sk-live-secret");
  });

  it("does not restore a redaction marker from non-sensitive extension fields", () => {
    const baseline: AgentSystemConfig = {
      ModelProviders: [],
      Extensions: {
        sample: { Configuration: { status: "ready" } },
      },
    };
    const next: AgentSystemConfig = {
      ModelProviders: [],
      Extensions: {
        sample: { Configuration: { status: Placeholder } },
      },
    };

    expect(restoreAgentSystemConfigSecrets(next, baseline)).toBe(next);
  });
});
