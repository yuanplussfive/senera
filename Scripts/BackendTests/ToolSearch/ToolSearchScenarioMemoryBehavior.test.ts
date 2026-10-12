import { describe, expect, test } from "vitest";
import {
  AgentToolSearchMemory,
  type AgentToolSearchEpisode,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemory.js";
import { VerificationScenarioSource } from "../../VerificationScenarioSource.js";
import { createToolSearchConfig } from "./ToolSearchTestFixtures.js";

function episode(): AgentToolSearchEpisode {
  return {
    query: "查看当地是否适合户外活动",
    queryTokens: [],
    plannerTags: [],
    candidates: [],
    chosenTools: ["Weather", "Broken"],
    activeSkills: [{ name: "outdoors", revision: "current" }],
    projectId: "project",
    timestamp: 1000,
    outcome: "success",
    finalScore: 0.8,
    finalOutcome: {
      toolExecutionSucceeded: true,
      producedEvidence: true,
      producedArtifact: false,
      changedWorkspace: false,
    },
    calls: ["Weather", "Broken"].map((toolName) => ({
      toolName,
      status: toolName === "Weather" ? "success" : "failure",
      score: toolName === "Weather" ? 0.9 : 0,
      argumentKeys: [],
      evidenceKinds: [],
      evidenceUris: [],
      artifactUris: [],
      hasArtifact: false,
      hasEvidence: toolName === "Weather",
      hasWorkspaceChanges: false,
      errorCode: "",
      error: "",
    })),
  };
}

describe("semantic scenario weights", () => {
  test("preserves semantic relevance without requiring keyword overlap and excludes failed calls", async () => {
    const scene = episode();
    const source = new VerificationScenarioSource([{ id: "scene", episode: scene, score: 0.75 }]);
    const memory = new AgentToolSearchMemory(createToolSearchConfig(), source);
    const matches = await memory.prepare("穿什么衣服", "project");
    const tools = memory.rank(matches, "project", 1000);
    expect(tools.map((item) => item.toolName)).toEqual(["Weather"]);
    expect(tools[0]?.evidence).toBeCloseTo(0.75 * 0.8 * 0.9);
    expect(
      memory.rankSkillScenarios({
        matches,
        projectId: "project",
        revisions: new Map([["outdoors", "current"]]),
        now: 1000,
      })[0]?.rankScore,
    ).toBeCloseTo((1 - Math.exp(-(0.75 * 0.8))) * Math.log1p(0.75 * 0.8));
    expect(
      memory.rankSkillScenarios({
        matches,
        projectId: "project",
        revisions: new Map([["outdoors", "changed"]]),
        now: 1000,
      }),
    ).toEqual([]);
  });
  test("does not retain matches from a previous request", async () => {
    let available = true;
    const memory = new AgentToolSearchMemory(createToolSearchConfig(), {
      search: async () => (available ? [{ id: "scene", episode: episode(), score: 0.9 }] : []),
      record: () => {},
    });
    expect(memory.rank(await memory.prepare("first", "project"), "project", 1000)).toHaveLength(1);
    available = false;
    expect(memory.rank(await memory.prepare("second", "project"), "project", 1000)).toEqual([]);
  });
});
