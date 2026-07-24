import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { SqliteToolSearchMemoryStore } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchSqliteMemoryStore.js";
import type { AgentToolSearchEpisode } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryTypes.js";

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
