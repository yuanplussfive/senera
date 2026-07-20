import crypto from "node:crypto";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import type { AgentInteractionRouteResult } from "../ActionPlanner/AgentInteractionRouter.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import { parsePiControllerAction, type ParsedPiControllerAction } from "../PiProxy/AgentPiAssistantMessageSchema.js";

export const AgentTurnPreparationSnapshotSchemaVersion = 2 as const;

export interface AgentTurnPreparationSnapshot {
  schemaVersion: typeof AgentTurnPreparationSnapshotSchemaVersion;
  runtimeFingerprint: string;
  inputDigest: string;
  piBranchBoundaryId?: string;
  turnUnderstanding?: TurnUnderstanding;
  route: AgentInteractionRouteResult;
  loadedToolNames: "all" | string[];
  rootCommand?: AgentRootCommand;
  initialAction: ParsedPiControllerAction;
  activeSkills: AgentActivatedSkill[];
}

export function createAgentTurnPreparationSnapshot(input: {
  runtimeFingerprint: string;
  userInput: string;
  turnUnderstanding?: TurnUnderstanding;
  route: AgentInteractionRouteResult;
  loadedToolNames: "all" | readonly string[];
  rootCommand?: AgentRootCommand;
  initialAction: ParsedPiControllerAction;
  activeSkills: readonly AgentActivatedSkill[];
}): AgentTurnPreparationSnapshot {
  return {
    schemaVersion: AgentTurnPreparationSnapshotSchemaVersion,
    runtimeFingerprint: input.runtimeFingerprint,
    inputDigest: digestAgentTurnInput(input.userInput),
    turnUnderstanding: input.turnUnderstanding,
    route: structuredClone(input.route),
    loadedToolNames: input.loadedToolNames === "all" ? "all" : [...input.loadedToolNames],
    rootCommand: input.rootCommand ? structuredClone(input.rootCommand) : undefined,
    initialAction: structuredClone(input.initialAction),
    activeSkills: input.activeSkills.map((skill) => structuredClone(skill)),
  };
}

export function isAgentTurnPreparationReusable(
  snapshot: AgentTurnPreparationSnapshot | undefined,
  input: { runtimeFingerprint?: string; userInput: string },
): snapshot is AgentTurnPreparationSnapshot {
  return Boolean(
    snapshot &&
    input.runtimeFingerprint &&
    snapshot.runtimeFingerprint === input.runtimeFingerprint &&
    snapshot.inputDigest === digestAgentTurnInput(input.userInput),
  );
}

export function withAgentTurnPreparationBoundary(
  snapshot: AgentTurnPreparationSnapshot,
  piBranchBoundaryId: string,
): AgentTurnPreparationSnapshot {
  return {
    ...structuredClone(snapshot),
    piBranchBoundaryId,
  };
}

export function parseAgentTurnPreparationSnapshot(value: unknown): AgentTurnPreparationSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<AgentTurnPreparationSnapshot>;
  if (
    record.schemaVersion !== AgentTurnPreparationSnapshotSchemaVersion ||
    typeof record.runtimeFingerprint !== "string" ||
    typeof record.inputDigest !== "string" ||
    !record.route ||
    (record.loadedToolNames !== "all" && !Array.isArray(record.loadedToolNames)) ||
    !Array.isArray(record.activeSkills) ||
    !record.initialAction
  ) {
    return undefined;
  }
  try {
    return {
      ...(record as AgentTurnPreparationSnapshot),
      initialAction: parsePiControllerAction(record.initialAction, {
        allowedTools:
          record.loadedToolNames === "all" ? readPreparedActionToolNames(record.initialAction) : record.loadedToolNames,
      }),
    };
  } catch {
    return undefined;
  }
}

function readPreparedActionToolNames(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const calls = (value as { calls?: unknown }).calls;
  return Array.isArray(calls)
    ? calls.flatMap((call) => {
        const toolName =
          call && typeof call === "object" && !Array.isArray(call)
            ? (call as { toolName?: unknown }).toolName
            : undefined;
        return typeof toolName === "string" ? [toolName] : [];
      })
    : [];
}

function digestAgentTurnInput(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
