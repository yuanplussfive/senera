import { describe, expect, test } from "vitest";
import { AgentActionPlannerBamlPromptFactory } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerBamlPromptFactory.js";
import type {
  AgentContinuityFactPromptInput,
  AgentContinuityRulePromptInput,
} from "../../../Source/AgentSystem/ActionPlanner/AgentLearningPromptJson.js";
import {
  createAgentContinuityFactExtractionContext,
  createAgentContinuityRuleExtractionContext,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityNativeExtractionPrompt.js";
import { AgentContinuityLearningPromptBundleRegistry } from "../../../Source/AgentSystem/Continuity/AgentContinuityLearningPromptBundle.js";

describe("continuity learning prompts", () => {
  test("keeps native and BAML fact routing aligned on persistent assistant behavior", async () => {
    const input = factInput();
    const bundle = promptBundle("facts");
    const native = createAgentContinuityFactExtractionContext(input, bundle.systemPrompt);
    const baml = await new AgentActionPlannerBamlPromptFactory().buildPrompt({
      functionName: "ExtractContinuityFacts",
      input,
      stablePrompt: bundle.systemPrompt,
    });
    const nativePrompt = native.systemPrompt;
    const bamlPrompt = baml.systemPrompt;

    for (const prompt of [nativePrompt, bamlPrompt]) {
      expect(prompt).toContain("future assistant behavior");
      expect(prompt).toContain("needsRulePass=true is a strict contract");
      expect(prompt).toContain("context.evidence");
      expect(prompt).toContain("context.turnContext and context.referents");
      expect(prompt).toContain("profileCatalog");
      expect(prompt).toContain("Registered relation catalog");
      expect(prompt).toContain('"lives_at"');
    }

    expect(native.systemPrompt).toContain("primary language");
    expect(native.systemPrompt).toContain("qualified claim");

    expect(JSON.parse(native.userPrompt)).toEqual(
      expect.objectContaining({
        context: expect.objectContaining({
          evidence: input.evidence,
          turnContext: input.turnContext,
          referents: input.referents,
        }),
        directive: { stage: "extractContinuityFacts" },
      }),
    );
    expect(native.userPrompt).not.toContain("capturePolicy");
    expect(native.userPrompt).not.toContain("relationCatalog");
    expect(baml.messages).toEqual([{ role: "user", content: native.userPrompt }]);
  });

  test("keeps native and BAML modeling aligned on shallow items and supplied state URIs", async () => {
    const input = ruleInput();
    const bundle = promptBundle("rules");
    const nativePrompt = createAgentContinuityRuleExtractionContext(input, bundle.systemPrompt).systemPrompt;
    const bamlPrompt = (
      await new AgentActionPlannerBamlPromptFactory().buildPrompt({
        functionName: "ExtractContinuityRules",
        input,
        stablePrompt: bundle.systemPrompt,
      })
    ).systemPrompt;

    for (const prompt of [nativePrompt, bamlPrompt]) {
      expect(prompt).toContain("one non-empty shallow items list");
      expect(prompt).toContain("kind=state");
      expect(prompt).toContain("Never invent a Senera URI");
      expect(prompt).toContain("explicit session or persistent instructions governing future assistant behavior");
      expect(prompt).toContain("same primary language as the latest meaningful user message");
      expect(prompt).toContain("do not translate or over-rewrite");
    }
  });
});

function factInput(): AgentContinuityFactPromptInput {
  return {
    timeZone: "Asia/Shanghai",
    completedAt: "2026-08-23T10:00:01+08:00",
    profileCatalog: { 居住地点: "上海" },
    agentProfileCatalog: {},
    agendaCatalog: [],
    evidence: [
      {
        kind: "user",
        text: "以后回复尽量简短自然，不要使用太多符号。",
        createdAt: "2026-08-23T10:00:00+08:00",
      },
    ],
    turnContext: [
      {
        kind: "assistant_final",
        text: "我会保持简短自然。",
        createdAt: "2026-08-23T10:00:01+08:00",
      },
    ],
    referents: [
      {
        role: "user",
        text: "上一轮也提到避免过多符号。",
        createdAt: "2026-08-23T09:59:00+08:00",
      },
    ],
  };
}

function promptBundle(stage: "facts" | "rules") {
  return new AgentContinuityLearningPromptBundleRegistry({
    listLearningInferences: () => [],
  }).get(stage, 12_000);
}

function ruleInput(): AgentContinuityRulePromptInput {
  return {
    ...factInput(),
    facts: ["用户要求后续回复保持简短自然，并减少非必要符号。"],
    stateCatalog: {
      "senera://continuity-state/state_aaaaaaaaaaaaaaaaaaaaaaaa": {
        summary: "用户已完成运动",
        scope: "workspace",
      },
    },
    ruleCatalog: {},
  };
}
