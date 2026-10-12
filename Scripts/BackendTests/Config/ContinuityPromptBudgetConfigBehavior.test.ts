import { describe, expect, test } from "vitest";
import { resolveContinuityLearningConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { projectAgentConfigForm } from "../../../Source/AgentSystem/Config/AgentConfigFormProjector.js";
import { AgentSystemConfigSchema } from "../../../Source/AgentSystem/Schemas/AgentSystemConfigSchema.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";

describe("continuity prompt budget configuration", () => {
  test("uses one configured budget in runtime and form projections", () => {
    const input = config({
      ContinuityLearning: { Recall: { PromptBudget: { MaxTokens: 8_000 } } },
    });

    expect(resolveContinuityLearningConfig(input).Recall.PromptBudget).toMatchObject({
      MaxTokens: 8_000,
    });
    expect(
      projectAgentConfigForm(input)
        .sections.flatMap((section) => section.fields)
        .find((field) => field.path.join(".") === "ContinuityLearning.Recall.PromptBudget.MaxTokens"),
    ).toMatchObject({ value: 8_000, effectiveValue: 8_000, configured: true });
  });

  test("rejects a non-positive budget at the schema boundary", () => {
    const parsed = AgentSystemConfigSchema.safeParse(
      config({ ContinuityLearning: { Recall: { PromptBudget: { MaxTokens: 0 } } } }),
    );

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: ["ContinuityLearning", "Recall", "PromptBudget", "MaxTokens"] }),
      );
    }
  });

  test("inherits the token default and permits a workspace override", () => {
    expect(resolveContinuityLearningConfig(config()).Recall.PromptBudget).toEqual({ MaxTokens: 16_384 });
    const resolved = resolveContinuityLearningConfig(
      config({
        Defaults: {
          ContinuityLearning: { Recall: { PromptBudget: { MaxTokens: 10_000 } } },
        },
      }),
    );

    expect(resolved.Recall.PromptBudget).toEqual({
      MaxTokens: 10_000,
    });
  });

  test("retires old count policies before strict JSON and database config validation", () => {
    const old = { ...config(), ConfigVersion: 34 };
    const migrated = migrateAgentConfigPayload({
      ...old,
      ContinuityLearning: {
        Recall: { PromptBudget: { MaxDigestEntries: 3, MaxEventEntries: 8, MaxCharacters: 24000 } },
      },
      Defaults: { ContinuityLearning: { Recall: { PromptBudget: { MaxEventEntries: 4 } } } },
    });
    expect(migrated?.removedPaths).toHaveLength(4);
    const parsed = AgentSystemConfigSchema.parse(migrated?.config);
    expect(resolveContinuityLearningConfig(parsed).Recall.PromptBudget).toEqual({ MaxTokens: 16384 });
    expect(
      AgentSystemConfigSchema.safeParse({
        ...parsed,
        ContinuityLearning: { Recall: { PromptBudget: { MaxEventEntries: 8 } } },
      }).success,
    ).toBe(false);
  });
});

function config(overrides: Partial<AgentSystemConfig> = {}): AgentSystemConfig {
  const provider = createModelProvider();
  return {
    DefaultModelProviderId: provider.Id,
    ModelProviderEndpoints: [
      { Id: provider.ProviderId, Kind: provider.Kind, BaseUrl: provider.BaseUrl, ApiKey: provider.ApiKey },
    ],
    ModelProviders: [
      { Id: provider.Id, ProviderId: provider.ProviderId, Model: provider.Model, Endpoint: provider.Endpoint },
    ],
    ...overrides,
  };
}
