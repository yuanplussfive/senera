import { z } from "zod";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import { sha256Hex } from "../Core/AgentHash.js";
import {
  cloneAgentToolAccessGrant,
  hasSameAgentToolNameSequence,
  parseAgentToolAccessGrant,
  type AgentToolAccessGrant,
} from "../ToolRuntime/AgentToolAccessGrant.js";

const ToolAccessGrantSnapshotSchema = z.object({}).passthrough();
const CapabilityNeedSchema = z
  .object({
    actions: z.array(z.string()),
    targets: z.array(z.string()),
    inputs: z.array(z.string()),
    outputs: z.array(z.string()),
    evidence: z.array(z.string()),
    effects: z.array(z.string()),
  })
  .strict();
const VisibleOutputRuleSchema = z
  .object({
    name: z.string(),
    value: z.string(),
    instruction: z.string().optional(),
  })
  .strict();
const RootCommandSnapshotSchema = z
  .object({
    authority: z.literal("senera_runtime_root"),
    action: z.enum(["answer", "ask_user", "discover_tools", "use_tools"]),
    outputMode: z.enum(["final_text", "open"]),
    toolAccess: z.enum(["disabled", "restricted", "discovery_only"]),
    objective: z.string(),
    instruction: z.string().nullable(),
    toolAccessGrant: ToolAccessGrantSnapshotSchema,
    forbiddenOutputs: z.array(z.string()),
    insufficiencyPolicy: z.string(),
    toolSearchQueries: z.array(z.string()),
    needs: z.array(CapabilityNeedSchema),
    includeToolCatalog: z.boolean(),
    visibleOutput: z
      .object({
        audience: z.string(),
        start: z.string(),
        format: z.string(),
        rules: z.array(VisibleOutputRuleSchema),
        repair: z
          .object({
            instruction: z.string(),
            rules: z.array(VisibleOutputRuleSchema),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
const EvidenceRequirementSchema = z
  .object({
    Need: z.string(),
    Accepts: z.array(z.string()),
    MinimumQuality: z.array(z.string()).optional(),
    Minimum: z.number().optional(),
    Purpose: z.string().optional(),
  })
  .strict();
const ActivatedSkillSnapshotSchema = z
  .object({
    name: z.string(),
    revision: z.string(),
    title: z.string(),
    summary: z.string(),
    useCases: z.array(z.string()),
    avoid: z.array(z.string()),
    recommendedTools: z.array(z.string()),
    evidenceRequirements: z.array(EvidenceRequirementSchema),
    descriptionFile: z.string(),
    matchedTerms: z.array(z.string()),
    matchedFields: z.array(
      z
        .object({
          term: z.string(),
          fields: z.array(z.string()),
        })
        .strict(),
    ),
    score: z.number(),
  })
  .strict();
const TurnPreparationSnapshotSchema = z
  .object({
    runtimeFingerprint: z.string(),
    inputDigest: z.string(),
    piBranchBoundaryId: z.string().optional(),
    loadedToolNames: z.array(z.string()),
    toolAccessGrant: ToolAccessGrantSnapshotSchema,
    rootCommand: RootCommandSnapshotSchema,
    activeSkills: z.array(ActivatedSkillSnapshotSchema),
  })
  .strict();

export interface AgentTurnPreparationSnapshot {
  runtimeFingerprint: string;
  inputDigest: string;
  piBranchBoundaryId?: string;
  loadedToolNames: string[];
  toolAccessGrant: AgentToolAccessGrant;
  rootCommand: AgentRootCommand;
  activeSkills: AgentActivatedSkill[];
}

export function createAgentTurnPreparationSnapshot(input: {
  runtimeFingerprint: string;
  userInput: string;
  loadedToolNames: readonly string[];
  toolAccessGrant: AgentToolAccessGrant;
  rootCommand: AgentRootCommand;
  activeSkills: readonly AgentActivatedSkill[];
}): AgentTurnPreparationSnapshot {
  const toolAccessGrant = cloneAgentToolAccessGrant(input.toolAccessGrant);
  return {
    runtimeFingerprint: input.runtimeFingerprint,
    inputDigest: sha256Hex(input.userInput),
    loadedToolNames: [...input.loadedToolNames],
    toolAccessGrant,
    rootCommand: cloneRootCommand(input.rootCommand, toolAccessGrant),
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
    snapshot.inputDigest === sha256Hex(input.userInput),
  );
}

export function withAgentTurnPreparationBoundary(
  snapshot: AgentTurnPreparationSnapshot,
  piBranchBoundaryId: string,
): AgentTurnPreparationSnapshot {
  const toolAccessGrant = cloneAgentToolAccessGrant(snapshot.toolAccessGrant);
  return {
    ...structuredClone(snapshot),
    piBranchBoundaryId,
    toolAccessGrant,
    rootCommand: cloneRootCommand(snapshot.rootCommand, toolAccessGrant),
  };
}

export function parseAgentTurnPreparationSnapshot(value: unknown): AgentTurnPreparationSnapshot | undefined {
  const parsed = TurnPreparationSnapshotSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const toolAccessGrant = parseAgentToolAccessGrant(parsed.data.toolAccessGrant);
  if (
    !toolAccessGrant ||
    !hasSameAgentToolNameSequence(parsed.data.loadedToolNames, toolAccessGrant.exposedToolNames)
  ) {
    return undefined;
  }
  const rootCommandGrant = parseAgentToolAccessGrant(parsed.data.rootCommand.toolAccessGrant);
  if (!rootCommandGrant || !sameToolAccessGrant(toolAccessGrant, rootCommandGrant)) return undefined;

  return {
    ...parsed.data,
    toolAccessGrant,
    rootCommand: cloneRootCommand({ ...parsed.data.rootCommand, toolAccessGrant }, toolAccessGrant),
  };
}

function cloneRootCommand(rootCommand: AgentRootCommand, toolAccessGrant: AgentToolAccessGrant): AgentRootCommand {
  return {
    ...structuredClone(rootCommand),
    toolAccessGrant,
  };
}

function sameToolAccessGrant(left: AgentToolAccessGrant, right: AgentToolAccessGrant): boolean {
  return (
    hasSameAgentToolNameSequence(left.authorizedToolNames, right.authorizedToolNames) &&
    hasSameAgentToolNameSequence(left.exposedToolNames, right.exposedToolNames) &&
    hasSameAgentToolNameSequence(left.preferredToolNames, right.preferredToolNames)
  );
}
