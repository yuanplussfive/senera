import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentActionPlannerContextBuilder } from "../Source/AgentSystem/AgentActionPlannerContext.js";
import { EmptyActionPlannerLedger } from "../Source/AgentSystem/AgentActionPlannerLedger.js";
import { AgentConversationProjector } from "../Source/AgentSystem/AgentConversationProjector.js";
import { createPlannerStateSnapshotEntry } from "../Source/AgentSystem/AgentPlannerMemory.js";
import { AgentSessionStore } from "../Source/AgentSystem/AgentSessionStore.js";
import { SqliteSessionRepository } from "../Source/AgentSystem/AgentSqliteSessionRepository.js";
import {
  TaskEvidenceScope,
  type ActionPlanInput,
  type TaskFrame,
} from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import type { AgentActionPlanResult } from "../Source/AgentSystem/AgentActionPlannerTypes.js";

const workspaceRoot = path.resolve(process.cwd());
const databasePath = path.join(workspaceRoot, ".senera", "planner-state-persistence-verification.sqlite");
fs.rmSync(databasePath, { force: true });

const sessionId = "session-planner-state";
const firstRequestId = "request-planner-state-1";
const secondRequestId = "request-planner-state-2";
const timestamp = "2026-06-21T00:00:00.000Z";
const conversation = new AgentConversationProjector();
const plannerStateEntry = createPlannerStateSnapshotEntry({
  requestId: firstRequestId,
  step: 1,
  timestamp,
  plan: createPlanResult(),
  ledger: EmptyActionPlannerLedger,
  loadedToolNames: ["WorkspaceSearchTool"],
});
assert.ok(plannerStateEntry);

{
  const repository = new SqliteSessionRepository(databasePath);
  const store = new AgentSessionStore({ repository });
  const opened = store.open(sessionId);
  assert.equal(opened.kind, "created");
  store.persistEntries(sessionId, [
    conversation.projectUserInput(firstRequestId, "看看项目是做什么的", timestamp),
    plannerStateEntry,
  ]);
  repository.close();
}

{
  const repository = new SqliteSessionRepository(databasePath);
  const store = new AgentSessionStore({ repository });
  store.hydrate();
  const loaded = store.open(sessionId);
  assert.equal(loaded.kind, "existing");
  const secondUser = conversation.projectUserInput(
    secondRequestId,
    "继续看",
    "2026-06-21T00:01:00.000Z",
  );
  const input = new AgentActionPlannerContextBuilder().buildInput({
    requestId: secondRequestId,
    userMessage: secondUser.content,
    currentStep: 1,
    dynamicTools: true,
    loadedToolNames: ["WorkspaceSearchTool"],
    messages: [
      {
        role: "user",
        content: "继续看",
      },
    ],
    conversationEntries: [
      ...loaded.session.conversation,
      secondUser,
    ],
    ledger: EmptyActionPlannerLedger,
    toolCatalog: [],
    activeSkills: [],
  });

  assert.equal(input.plannerState?.requestId, firstRequestId);
  assert.equal(input.plannerState?.userGoal, "Understand what the workspace project does.");
  assert.equal(input.plannerState?.lastAction, "use_tools");
  assert.deepEqual(input.plannerState?.loadedTools, ["WorkspaceSearchTool"]);
  repository.close();
}

fs.rmSync(databasePath, { force: true });
console.log("Planner state persistence verification passed.");

function createPlanResult(): AgentActionPlanResult {
  return {
    kind: "planned",
    selectedAction: "use_tools",
    selectionRepaired: false,
    payloadRepaired: false,
    input: createPlannerInput(),
    taskFrame: createTaskFrame(),
    decision: {
      action: "use_tools",
      useTools: {
        preferredTools: ["WorkspaceSearchTool"],
        instruction: "Inspect the workspace structure and project entry points.",
        needs: [],
      },
    },
  };
}

function createPlannerInput(): ActionPlanInput {
  return {
    currentUserTurn: {
      content: "看看项目是做什么的",
    },
    runState: {
      currentStep: 1,
      dynamicTools: true,
      loadedTools: ["WorkspaceSearchTool"],
      progress: {
        totalToolCalls: 0,
        totalEvidence: 0,
        lastNewEvidenceStep: 0,
        repeatedCallCount: 0,
        stalled: false,
      },
      warnings: [],
      calls: [],
    },
    timeline: [{
      index: 0,
      role: "user",
      kind: "user_message",
      content: "看看项目是做什么的",
      evidenceUris: [],
      artifactUris: [],
    }],
    evidenceMemory: [],
    evidenceState: [],
    plannerJournal: [],
    toolTagCatalog: ["workspace", "项目"],
    compactToolCatalog: [],
    toolCatalog: [],
    activeSkills: [],
  };
}

function createTaskFrame(): TaskFrame {
  return {
    taskType: "workspace inspection",
    answerGoal: "Understand what the workspace project does.",
    intentTags: ["workspace", "inspection"],
    taskTags: ["workspace", "项目"],
    targetRefs: [{
      kind: "workspace",
      value: workspaceRoot,
      status: "needs-inspection",
    }],
    candidateTools: [{
      name: "WorkspaceSearchTool",
      purpose: "Inspect workspace files and structure.",
      supports: ["workspace inspection"],
    }],
    discoveryQueries: [],
    requiredEffects: [],
    requiredEvidence: [{
      id: "workspace-understanding",
      need: "workspace files and project structure",
      scope: TaskEvidenceScope.CurrentRun,
      minimum: 1,
      reason: "The answer depends on reading the workspace.",
    }],
    userInputNeeds: [],
    nextStepPurpose: "Inspect workspace files before answering.",
    completionCriteria: ["The answer is grounded in workspace evidence."],
    notes: [],
  };
}
