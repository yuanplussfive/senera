import assert from "node:assert/strict";
import { normalizeBamlOptionalFields } from "../Source/AgentSystem/BamlClient/AgentBamlOutputNormalizer.js";
import { parseFastContextScoutPlannerDecision } from "../Source/AgentSystem/ActionPlanner/AgentFastContextScoutPlannerSchema.js";
import type { AgentFastContextScoutPlannerPromptInput } from "../Source/AgentSystem/ActionPlanner/AgentFastContextScoutPlannerPromptJson.js";

const scoutInput: AgentFastContextScoutPlannerPromptInput = {
  stage: "planFastContextScout",
  workspaceRoot: process.cwd(),
  virtualRoot: "/codebase",
  question: "Where is the model config?",
  queryPlan: {
    item: ["model config"],
  },
  commandBudget: {
    maxRounds: 2,
    maxCommandsPerRound: 4,
  },
  allowedCommands: {
    item: [
      {
        type: "rg",
        description: "Search workspace text with ripgrep.",
        args: {},
      },
      {
        type: "readfile",
        description: "Read a workspace file range.",
        args: {},
      },
      {
        type: "tree",
        description: "Inspect workspace directory tree.",
        args: {},
      },
      {
        type: "glob",
        description: "Find workspace files by glob pattern.",
        args: {},
      },
    ],
  },
  deterministicCandidates: {
    item: [],
  },
  round: 1,
  observations: {
    item: [],
  },
};

const normalized = normalizeBamlOptionalFields({
  keep: "value",
  omit: null,
  nested: {
    omit: null,
    keep: 1,
  },
  list: [
    null,
    {
      omit: null,
      keep: true,
    },
  ],
});

assert.deepEqual(normalized, {
  keep: "value",
  nested: {
    keep: 1,
  },
  list: [
    null,
    {
      keep: true,
    },
  ],
});

const parsed = parseFastContextScoutPlannerDecision({
  action: "commands",
  commands: [
    {
      type: "readfile",
      path: "Source/AgentSystem/AgentActionPlanner.ts",
      pattern: null,
      startLine: null,
      endLine: null,
      depth: null,
    },
  ],
  files: [],
  reason: "Need to inspect the file.",
} as unknown as Parameters<typeof parseFastContextScoutPlannerDecision>[0], scoutInput);

const command = parsed.commands[0];
assert.ok(command);
assert.equal(command.type, "readfile");
assert.equal(command.path, "Source/AgentSystem/AgentActionPlanner.ts");
assert.equal("startLine" in command, false);
assert.equal("endLine" in command, false);
assert.equal("depth" in command, false);
assert.equal("pattern" in command, false);

assert.throws(
  () => parseFastContextScoutPlannerDecision({
    action: "commands",
    commands: [
      {
        type: null,
        path: "Source/AgentSystem/AgentActionPlanner.ts",
      },
    ],
    files: [],
    reason: "Missing required command type.",
  } as unknown as Parameters<typeof parseFastContextScoutPlannerDecision>[0], scoutInput),
  /commands\[0\]\.type/,
);

assert.throws(
  () => parseFastContextScoutPlannerDecision({
    action: "commands",
    commands: [
      {
        type: "rg",
        pattern: "ModelProviders",
        include: [null],
      },
    ],
    files: [],
    reason: "Array element null is invalid.",
  } as unknown as Parameters<typeof parseFastContextScoutPlannerDecision>[0], scoutInput),
  /commands\[0\]\.include\[0\]/,
);

console.log("BAML optional field normalization verification passed.");
