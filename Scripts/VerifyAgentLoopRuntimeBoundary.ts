import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentLoopSchema } from "../Source/AgentSystem/Schemas/AgentRuntimeConfigSchema.js";

const workspaceRoot = resolveWorkspaceRoot();

const files = {
  loop: readSource("Source/AgentSystem/Loop/AgentLoop.ts"),
  preparation: readSource("Source/AgentSystem/Loop/AgentTurnPreparationService.ts"),
  piTurn: readSource("Source/AgentSystem/Pi/AgentPiTurnExecutor.ts"),
  runtimeTypes: readSource("Source/AgentSystem/Types/AgentRuntimeConfigTypes.ts"),
};
const formDocument = JSON.parse(readSource("Source/AgentSystem/Config/AgentSystemConfig.form.json")) as {
  form: {
    sections: Array<{
      fields: Array<{
        path?: string[];
      }>;
    }>;
  };
};
const exampleConfig = JSON.parse(readSource("senera.config.example.json")) as {
  Defaults?: {
    AgentLoop?: Record<string, unknown>;
  };
};

assertNoAgentLoopMaxSteps();
assertNoOuterLoopRepairAttempts();
assertNoOuterPlanningRuntime();
assertPiRuntimeFieldsRemain();

console.log("Agent loop runtime boundary verified.");

function assertNoAgentLoopMaxSteps() {
  assert.equal("MaxSteps" in AgentDefaults.AgentLoop, false);
  assert.equal("MaxSteps" in (exampleConfig.Defaults?.AgentLoop ?? {}), false);
  assert.equal(
    AgentLoopSchema.safeParse({ MaxSteps: 1 }).success,
    false,
    "AgentLoop schema must reject retired MaxSteps.",
  );
  assert.equal(hasConfigFormField(["AgentLoop", "MaxSteps"]), false);
  assert.equal(files.runtimeTypes.includes("MaxSteps"), false);
}

function assertNoOuterLoopRepairAttempts() {
  assert.equal("MaxRepairAttempts" in AgentDefaults.AgentLoop, false);
  assert.equal("MaxRepairAttempts" in (exampleConfig.Defaults?.AgentLoop ?? {}), false);
  assert.equal(
    AgentLoopSchema.safeParse({ MaxRepairAttempts: 1 }).success,
    false,
    "AgentLoop schema must reject retired MaxRepairAttempts.",
  );
  assert.equal(hasConfigFormField(["AgentLoop", "MaxRepairAttempts"]), false);
  assert.equal(files.runtimeTypes.includes("MaxRepairAttempts"), false);
}

function assertNoOuterPlanningRuntime() {
  for (const retiredSymbol of [
    "prepare_interaction",
    "PrepareTurn",
    "AgentLoopStateMachine",
    "AgentPiPreparedActionLease",
  ]) {
    assert.equal(files.loop.includes(retiredSymbol), false, `AgentLoop must not reference ${retiredSymbol}.`);
    assert.equal(
      files.preparation.includes(retiredSymbol),
      false,
      `Turn preparation must not reference ${retiredSymbol}.`,
    );
    assert.equal(files.piTurn.includes(retiredSymbol), false, `Pi turn must not reference ${retiredSymbol}.`);
  }
}

function assertPiRuntimeFieldsRemain() {
  for (const field of [
    "PiTurnLeaseTimeoutSeconds",
    "PiSessions",
    "PiTurnLeaseTimeoutMs",
    "RunSettlementTimeoutSeconds",
    "RunSettlementTimeoutMs",
  ]) {
    assert.equal(
      files.runtimeTypes.includes(field) || field in AgentDefaults.AgentLoop,
      true,
      `AgentLoop runtime config must keep real Pi runtime field ${field}.`,
    );
  }
}

function hasConfigFormField(pathSegments: readonly string[]): boolean {
  const expected = pathSegments.join(".");
  return formDocument.form.sections
    .flatMap((section) => section.fields)
    .some((field) => field.path?.join(".") === expected);
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");
}

function resolveWorkspaceRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (current !== path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, "package.json")) &&
      fs.existsSync(path.join(current, "Source", "AgentSystem"))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error("Unable to resolve workspace root.");
}
