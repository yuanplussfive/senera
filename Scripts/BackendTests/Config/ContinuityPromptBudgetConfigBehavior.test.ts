import { describe, expect, test } from "vitest";
import { resolveContinuityLearningConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { projectAgentConfigForm } from "../../../Source/AgentSystem/Config/AgentConfigFormProjector.js";
import { AgentSystemConfigSchema } from "../../../Source/AgentSystem/Schemas/AgentSystemConfigSchema.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createModelProvider, createModelProviderEndpoint } from "../Support/AgentTestFixtures.js";

describe("continuity prompt budget configuration", () => {
  test("uses one configured budget in runtime and form projections", () => {
    const input = config({
      ContinuityLearning: { Recall: { PromptBudget: { MaxFactEntries: 12, MaxCharacters: 8_000 } } },
    });

    expect(resolveContinuityLearningConfig(input).Recall.PromptBudget).toMatchObject({
      MaxProfileEntries: 32,
      MaxFactEntries: 12,
      MaxCharacters: 8_000,
    });
    expect(
      projectAgentConfigForm(input)
        .sections.flatMap((section) => section.fields)
        .find((field) => field.path.join(".") === "ContinuityLearning.Recall.PromptBudget.MaxFactEntries"),
    ).toMatchObject({ value: 12, effectiveValue: 12, configured: true });
  });

  test("rejects a non-positive budget at the schema boundary", () => {
    const parsed = AgentSystemConfigSchema.safeParse(
      config({ ContinuityLearning: { Recall: { PromptBudget: { MaxCharacters: 0 } } } }),
    );

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: ["ContinuityLearning", "Recall", "PromptBudget", "MaxCharacters"] }),
      );
    }
  });

  test("deeply merges a partial default budget without losing sibling limits", () => {
    const resolved = resolveContinuityLearningConfig(
      config({
        Defaults: {
          ContinuityLearning: { Recall: { PromptBudget: { MaxFactEntries: 10 } } },
        },
      }),
    );

    expect(resolved.Recall.PromptBudget).toEqual({
      MaxProfileEntries: 32,
      MaxFactEntries: 10,
      MaxRelationEntries: 24,
      MaxEventEntries: 8,
      MaxEvidenceEntries: 8,
      MaxCharacters: 24_000,
    });
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
