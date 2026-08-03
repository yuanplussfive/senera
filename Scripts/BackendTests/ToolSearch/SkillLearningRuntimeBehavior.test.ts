import { describe, expect, test } from "vitest";
import type { AgentActivatedSkill } from "../../../Source/AgentSystem/Skills/AgentSkillActivation.js";
import {
  AgentLearningStates,
  AgentLearningDomains,
} from "../../../Source/AgentSystem/ToolSearch/AgentLearningEpisodeTypes.js";
import { AgentSkillLearningRuntime } from "../../../Source/AgentSystem/ToolSearch/AgentSkillLearningRuntime.js";
import { AgentToolSearchMemory } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemory.js";
import { InMemoryToolSearchMemoryStore } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryStore.js";
import type { AgentToolSearchEpisode } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryTypes.js";
import { AgentToolSearchTokenizer } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchTokenizer.js";
import { createToolSearchConfig } from "./ToolSearchTestFixtures.js";

describe("Skill routing learning", () => {
  test("persists grounded terms and invalidates them when the Skill revision changes", () => {
    const memory = createMemory();
    const runtime = new AgentSkillLearningRuntime(memory);
    runtime.learn({
      episode: successfulEpisode(),
      requestId: "request-learned",
      sessionId: "session-1",
      rawUserTurn: "批量提取 CSV 指定列",
      standaloneRequest: "批量提取 CSV 指定列",
      contextMode: "None",
      contextBasis: "",
      activeSkills: [activatedSkill("csv-column-selector", "revision-1", ["WorkspaceReadFile"], ["csv", "指定列"])],
    });

    expect(memory.learningEpisodes("project-a", 10)).toEqual([
      expect.objectContaining({
        domain: AgentLearningDomains.SkillRouting,
        state: AgentLearningStates.Learned,
        requestId: "request-learned",
      }),
    ]);
    const queryTokens = new AgentToolSearchTokenizer().tokenize("批量提取 CSV 指定列");
    expect(
      memory.rankSkills({
        queryTokens,
        projectId: "project-a",
        revisions: new Map([["csv-column-selector", "revision-1"]]),
      }),
    ).toEqual([
      expect.objectContaining({
        skillName: "csv-column-selector",
        skillRevision: "revision-1",
        terms: expect.arrayContaining(["csv"]),
      }),
    ]);
    expect(
      memory.rankSkills({
        queryTokens,
        projectId: "project-a",
        revisions: new Map([["csv-column-selector", "revision-2"]]),
      }),
    ).toEqual([]);
    memory.close();
  });

  test("learns only selector-grounded terms instead of arbitrary request content", () => {
    const memory = createMemory();
    const runtime = new AgentSkillLearningRuntime(memory);
    runtime.learn({
      episode: successfulEpisode(),
      requestId: "request-grounded-terms",
      rawUserTurn: "批量提取 CSV 指定列，附带 unrelated-sensitive-value",
      standaloneRequest: "批量提取 CSV 指定列，附带 unrelated-sensitive-value",
      contextMode: "None",
      contextBasis: "",
      activeSkills: [activatedSkill("csv-column-selector", "revision-1", ["WorkspaceReadFile"], ["csv", "指定列"])],
    });

    expect(new Set(memory.skillLearningTerms("project-a", "csv-column-selector").map((term) => term.term))).toEqual(
      new Set(["csv", "指定列"]),
    );
    memory.close();
  });

  test("records ambiguous attribution as skipped instead of polluting multiple Skills", () => {
    const memory = createMemory();
    const runtime = new AgentSkillLearningRuntime(memory);
    runtime.learn({
      episode: successfulEpisode(),
      requestId: "request-ambiguous",
      rawUserTurn: "处理这份数据",
      standaloneRequest: "处理这份数据",
      contextMode: "None",
      contextBasis: "",
      activeSkills: [activatedSkill("first-skill", "revision-1", []), activatedSkill("second-skill", "revision-1", [])],
    });

    expect(memory.learningEpisodes("project-a", 10)).toEqual([
      expect.objectContaining({
        state: AgentLearningStates.Skipped,
        reason: expect.stringContaining("multiple active Skills"),
      }),
    ]);
    expect(
      memory.rankSkills({
        queryTokens: new AgentToolSearchTokenizer().tokenize("处理这份数据"),
        projectId: "project-a",
        revisions: new Map([
          ["first-skill", "revision-1"],
          ["second-skill", "revision-1"],
        ]),
      }),
    ).toEqual([]);
    memory.close();
  });
});

function createMemory(): AgentToolSearchMemory {
  return new AgentToolSearchMemory(createToolSearchConfig(), "E:/workspace", new InMemoryToolSearchMemoryStore());
}

function successfulEpisode(): Omit<AgentToolSearchEpisode, "learnedKeywords"> {
  return {
    query: "extract selected CSV columns",
    queryTokens: ["extract", "csv", "columns"],
    plannerTags: [],
    candidates: ["WorkspaceReadFile"],
    chosenTools: ["WorkspaceReadFile"],
    outcome: "success",
    calls: [
      {
        toolName: "WorkspaceReadFile",
        argumentKeys: ["path"],
        evidenceKinds: ["file"],
        status: "success",
        evidenceUris: ["senera://evidence/file"],
        artifactUris: ["senera://artifact/file"],
        hasArtifact: true,
        hasEvidence: true,
        hasWorkspaceChanges: false,
        errorCode: "",
        error: "",
        score: 1,
      },
    ],
    finalScore: 1,
    finalOutcome: {
      toolExecutionSucceeded: true,
      producedEvidence: true,
      producedArtifact: true,
      changedWorkspace: false,
    },
    projectId: "project-a",
    timestamp: Date.UTC(2026, 0, 1),
  };
}

function activatedSkill(
  name: string,
  revision: string,
  recommendedTools: string[],
  matchedTerms: string[] = ["data"],
): AgentActivatedSkill {
  return {
    name,
    revision,
    title: name,
    summary: `${name} summary`,
    useCases: [],
    avoid: [],
    recommendedTools,
    evidenceRequirements: [],
    descriptionFile: `.senera/skills/${name}/SKILL.md`,
    matchedTerms,
    matchedFields: matchedTerms.map((term) => ({ term, fields: ["summary"] })),
    score: 1,
  };
}
