import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { SqliteToolSearchMemoryStore } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchSqliteMemoryStore.js";
import type { AgentToolSearchEpisode } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryTypes.js";
import {
  AgentLearningDomains,
  AgentLearningStates,
  type AgentLearningEpisode,
} from "../../../Source/AgentSystem/ToolSearch/AgentLearningEpisodeTypes.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite tool-search learning store", () => {
  test("rebuilds the pre-contract schema that lacks learned_keywords", () => {
    const databasePath = temporaryDatabasePath();
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE tool_search_episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        query_tokens TEXT NOT NULL,
        planner_tags TEXT NOT NULL,
        candidates TEXT NOT NULL,
        chosen_tools TEXT NOT NULL,
        outcome TEXT NOT NULL,
        calls TEXT NOT NULL,
        final_score REAL NOT NULL,
        final_outcome TEXT NOT NULL,
        project_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `);
    legacy.close();

    const store = new SqliteToolSearchMemoryStore(databasePath);
    store.add(episode(), { terms: [], patterns: [] });

    expect(store.list("project-a", 10)).toEqual([episode()]);
    store.close();
  });

  test("persists observable learning state and revision-bound Skill terms", () => {
    const store = new SqliteToolSearchMemoryStore(temporaryDatabasePath());
    store.recordLearningEpisode(learningEpisode());
    store.commitSkillLearning([skillTerm()], "learning-1", {
      state: AgentLearningStates.Learned,
      reason: "grounded successful use",
      updatedAtMs: 2,
    });

    expect(store.learningEpisode("project-a", "learning-1")).toEqual(
      expect.objectContaining({ state: AgentLearningStates.Learned, reason: "grounded successful use" }),
    );
    expect(store.learningSummary("project-a")).toEqual({
      episodeCount: 1,
      episodeGroups: [{ domain: AgentLearningDomains.SkillRouting, state: AgentLearningStates.Learned, count: 1 }],
      skillTermCount: 1,
    });
    expect(store.skillLearningTerms("project-a")).toEqual([
      expect.objectContaining({ skillName: "csv-column-selector", skillRevision: "revision-1", term: "csv" }),
    ]);
    store.close();
  });

  test("rolls back learned Skill terms when the observation transition cannot commit", () => {
    const store = new SqliteToolSearchMemoryStore(temporaryDatabasePath());

    expect(() =>
      store.commitSkillLearning([skillTerm()], "missing-learning-episode", {
        state: AgentLearningStates.Learned,
        reason: "must roll back",
        updatedAtMs: 2,
      }),
    ).toThrow(/does not exist/);
    expect(store.skillLearningTerms("project-a")).toEqual([]);
    store.close();
  });
});

function temporaryDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "senera-tool-search-store-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "ToolSearchLearning.sqlite");
}

function episode(): AgentToolSearchEpisode {
  return {
    query: "read workspace",
    queryTokens: ["read", "workspace"],
    plannerTags: ["workspace"],
    candidates: ["WorkspaceReadFile"],
    chosenTools: ["WorkspaceReadFile"],
    learnedKeywords: [
      {
        toolName: "WorkspaceReadFile",
        value: "workspace file",
        source: "toolLearning.trigger",
        weight: 1,
      },
    ],
    outcome: "success",
    calls: [
      {
        toolName: "WorkspaceReadFile",
        argumentKeys: ["path"],
        evidenceKinds: ["workspace-file"],
        status: "success",
        evidenceUris: [],
        artifactUris: [],
        hasArtifact: false,
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
      producedArtifact: false,
      changedWorkspace: false,
    },
    projectId: "project-a",
    timestamp: 1,
  };
}

function learningEpisode(): AgentLearningEpisode {
  return {
    id: "learning-1",
    domain: AgentLearningDomains.SkillRouting,
    state: AgentLearningStates.Observed,
    reason: "",
    error: "",
    attempts: 0,
    projectId: "project-a",
    sessionId: "session-1",
    requestId: "request-1",
    query: "extract CSV columns",
    subjects: [{ kind: "skill", name: "csv-column-selector", revision: "revision-1" }],
    context: {
      rawUserTurn: "extract CSV columns",
      standaloneRequest: "extract CSV columns",
      contextMode: "None",
      contextBasis: "",
      candidates: ["WorkspaceReadFile"],
      chosenTools: ["WorkspaceReadFile"],
      activeSkills: [{ name: "csv-column-selector", revision: "revision-1", matchedTerms: ["csv"] }],
    },
    outcome: {
      outcome: "success",
      score: 1,
      calls: episode().calls,
      final: episode().finalOutcome,
    },
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function skillTerm() {
  return {
    projectId: "project-a",
    skillName: "csv-column-selector",
    skillRevision: "revision-1",
    term: "csv",
    source: "successful_skill_use",
    support: 1,
    weight: 1,
    lastSeenAt: 2,
  };
}
