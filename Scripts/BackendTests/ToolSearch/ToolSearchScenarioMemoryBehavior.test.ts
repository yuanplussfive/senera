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

function toolEpisode(options: {
  query: string;
  toolName: string;
  status: "success" | "failure" | "empty";
  outcome?: "success" | "failure" | "unknown";
  timestamp?: number;
}): AgentToolSearchEpisode {
  const base = episode();
  const failed = options.outcome === "failure";
  return {
    ...base,
    query: options.query,
    timestamp: options.timestamp ?? base.timestamp,
    outcome: options.outcome ?? "success",
    finalScore: failed ? 0 : 1,
    chosenTools: [options.toolName],
    calls: [
      {
        ...base.calls[0]!,
        toolName: options.toolName,
        status: options.status,
        score: options.status === "success" ? 0.9 : 0,
      },
    ],
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
    expect(tools[0]?.evidence).toBeCloseTo(0.75);
    expect(tools[0]?.confidence).toBeCloseTo((1 + 0.75) / (2 + 0.75));
    expect(tools[0]?.rankScore).toBeLessThan(tools[0]?.confidence ?? 0);
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
  test("collapses repeated recalls of one query into a single observation", async () => {
    const repeated = Array.from({ length: 5 }, (_, index) => ({
      id: `repeat-${index}`,
      episode: toolEpisode({ query: "读取配置文件", toolName: "ReadFile", status: "success", timestamp: 1000 + index }),
      score: 0.5,
    }));
    const memory = new AgentToolSearchMemory(createToolSearchConfig(), new VerificationScenarioSource(repeated));
    const tools = memory.rank(await memory.prepare("读取配置文件", "project"), "project", 1004);

    expect(tools).toHaveLength(1);
    expect(tools[0]?.evidence).toBeCloseTo(0.5);
    expect(tools[0]?.signals).toHaveLength(1);
  });

  test("charges failed calls against the reliability lower bound", async () => {
    const matches = [
      {
        id: "shared-success",
        episode: toolEpisode({ query: "天气", toolName: "Weather", status: "success" }),
        score: 1,
      },
      { id: "other-success", episode: toolEpisode({ query: "天气", toolName: "Other", status: "success" }), score: 1 },
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `weather-failure-${index}`,
        episode: toolEpisode({
          query: `失败场景 ${index}`,
          toolName: "Weather",
          status: "failure",
          outcome: "failure",
        }),
        score: 1,
      })),
    ];
    const memory = new AgentToolSearchMemory(createToolSearchConfig(), new VerificationScenarioSource(matches));
    const tools = memory.rank(await memory.prepare("天气", "project"), "project", 1000);

    expect(tools.map((item) => item.toolName)).toEqual(["Other", "Weather"]);
    expect(tools[0]?.evidence).toBeCloseTo(1);
    expect(tools[1]?.evidence).toBeCloseTo(21);
    expect(tools[0]?.rankScore).toBeGreaterThan(tools[1]?.rankScore ?? 0);
  });
});
