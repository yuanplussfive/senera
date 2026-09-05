import { describe, expect, test } from "vitest";
import { resolvePresetsConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentSystemConfigSchema } from "../../../Source/AgentSystem/Schemas/AgentSystemConfigSchema.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createModelProvider, createModelProviderEndpoint } from "../Support/AgentTestFixtures.js";

describe("preset prompt budget configuration", () => {
  test("deeply merges default and runtime persona budgets", () => {
    const resolved = resolvePresetsConfig(
      config({
        Defaults: { Presets: { PromptBudget: { MaxExamples: 2 } } },
        Presets: { PromptBudget: { MaxLoreEntries: 3 } },
      }),
    );

    expect(resolved.PromptBudget).toEqual({
      MaxExamples: 2,
      MaxLoreEntries: 3,
      MaxSupplementalCharacters: 12_000,
    });
  });

  test("rejects non-positive persona budgets at the schema boundary", () => {
    const parsed = AgentSystemConfigSchema.safeParse(
      config({ Presets: { PromptBudget: { MaxSupplementalCharacters: 0 } } }),
    );

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: ["Presets", "PromptBudget", "MaxSupplementalCharacters"] }),
      );
    }
  });
});

function config(overrides: Partial<AgentSystemConfig> = {}): AgentSystemConfig {
  const provider = createModelProvider();
  return {
    DefaultModelProviderId: provider.Id,
    ModelProviderEndpoints: [createModelProviderEndpoint()],
    ModelProviders: [provider],
    ...overrides,
  };
}
