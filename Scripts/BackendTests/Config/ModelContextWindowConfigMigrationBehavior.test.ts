import { describe, expect, test } from "vitest";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";

describe("model context window config migration", () => {
  test("removes the legacy unknown marker while preserving explicit context windows", () => {
    expect(
      migrateAgentConfigPayload({
        ConfigVersion: 7,
        ModelProviders: [
          {
            Id: "default-context",
            ProviderId: "main",
            Endpoint: "ChatCompletions",
            Model: "default-context",
            ContextWindowTokens: -1,
          },
          {
            Id: "configured-context",
            ProviderId: "main",
            Endpoint: "ChatCompletions",
            Model: "configured-context",
            ContextWindowTokens: 64_000,
          },
        ],
      }),
    ).toEqual({
      sourceVersion: 7,
      targetVersion: CurrentAgentConfigVersion,
      migratedPaths: ["ConfigVersion"],
      removedPaths: ["ModelProviders[0].ContextWindowTokens"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ModelProviders: [
          {
            Id: "default-context",
            ProviderId: "main",
            Endpoint: "ChatCompletions",
            Model: "default-context",
          },
          {
            Id: "configured-context",
            ProviderId: "main",
            Endpoint: "ChatCompletions",
            Model: "configured-context",
            ContextWindowTokens: 64_000,
          },
        ],
      },
    });
  });
});
