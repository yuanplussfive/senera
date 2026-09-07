import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentRoleplayPresetContext } from "../Presets/AgentPresetTypes.js";
import type { AgentContinuityMemoryPromptContext } from "../Continuity/AgentContinuityMemoryTypes.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentExecutionEnvironmentContext } from "./AgentExecutionEnvironmentContext.js";
import type { AgentPromptContext, AgentPromptToolContext } from "./AgentPromptContextTypes.js";
import type { AgentWorkflowPromptContext } from "./AgentWorkflowPromptContext.js";
import type { AgentSceneContext } from "./AgentSceneContextCompiler.js";
import type {
  AgentPromptContextLayerManifestEntry,
  AgentPromptContextRevisions,
} from "./AgentPromptContextLayerTypes.js";

export interface AgentPromptContextCompilerInput {
  readonly executionEnvironment: AgentExecutionEnvironmentContext;
  readonly toolCards: readonly AgentPromptToolContext[];
  readonly toolDiscoveryToolName: string | null;
  readonly rootCommand: AgentRootCommand | null;
  readonly roleplayPreset: AgentRoleplayPresetContext;
  readonly continuityMemory: AgentContinuityMemoryPromptContext;
  readonly workflow: AgentWorkflowPromptContext;
  readonly scene: AgentSceneContext;
}

/**
 * Compiles the model-facing context envelope from already-authorized runtime data.
 * The compiler does not discover tools, evaluate rules, or grant capabilities.
 */
export function compileAgentPromptContext(input: AgentPromptContextCompilerInput): AgentPromptContext {
  return {
    ExecutionEnvironment: input.executionEnvironment,
    ToolCards: [...input.toolCards],
    ToolDiscoveryToolName: input.toolDiscoveryToolName,
    RootCommand: input.rootCommand,
    RoleplayPreset: normalizeAgentRoleplayTemplateContext(input.roleplayPreset),
    ContinuityMemory: input.continuityMemory,
    Workflow: input.workflow,
    Scene: input.scene,
    ContextLayers: buildLayerManifest(input),
    ContextRevisions: buildContextRevisions(input),
  };
}

const EmptyAgentRoleplayCard = Object.freeze({
  title: "",
  corePersona: "",
  languageStyle: "",
  examples: [],
  lore: [],
});

/**
 * Prompt templates run under a strict-variable Liquid engine, where evaluating
 * an undefined variable inside a conditional still throws. A persona card may
 * be absent (an enabled preset without an activated card), so every template
 * consumer must observe a card-shaped object; an empty card renders nothing
 * and keeps the guard conditions (`enabled and activePresetName`) safe.
 */
export function normalizeAgentRoleplayTemplateContext(
  roleplayPreset: AgentRoleplayPresetContext,
): AgentRoleplayPresetContext {
  if (!roleplayPreset.enabled || !roleplayPreset.activePresetName || roleplayPreset.card) {
    return roleplayPreset;
  }
  return { ...roleplayPreset, card: EmptyAgentRoleplayCard };
}

function buildContextRevisions(input: AgentPromptContextCompilerInput): AgentPromptContextRevisions {
  return {
    stable: sha256HexOfCanonicalJson({
      executionEnvironment: input.executionEnvironment,
      roleplayPreset: stableRoleplayPreset(input.roleplayPreset),
    }),
    context: sha256HexOfCanonicalJson({
      toolCards: input.toolCards,
      toolDiscoveryToolName: input.toolDiscoveryToolName,
    }),
    volatile: sha256HexOfCanonicalJson({
      rootCommand: input.rootCommand,
      roleplayLore: input.roleplayPreset.card?.lore ?? [],
      continuityMemory: input.continuityMemory,
      workflow: input.workflow,
      scene: input.scene,
    }),
  };
}

function buildLayerManifest(input: AgentPromptContextCompilerInput): readonly AgentPromptContextLayerManifestEntry[] {
  return [
    {
      name: "kernel",
      source: "runtime",
      stability: "stable",
      included: true,
    },
    {
      name: "persona",
      source: "preset",
      stability: "stable",
      included: input.roleplayPreset.enabled && input.roleplayPreset.card !== undefined,
    },
    {
      name: "profile",
      source: "profile",
      stability: "turn",
      included: input.continuityMemory.residentProfile.length > 0,
    },
    {
      name: "lore",
      source: "preset",
      stability: "turn",
      included: (input.roleplayPreset.card?.lore.length ?? 0) > 0,
    },
    {
      name: "facts",
      source: "continuity",
      stability: "turn",
      included: input.continuityMemory.factCatalog.length > 0,
    },
    {
      name: "graph",
      source: "continuity",
      stability: "turn",
      included: input.continuityMemory.graphRelations.length > 0,
    },
    {
      name: "world",
      source: "runtime",
      stability: "event",
      included: input.workflow.world !== null,
    },
    {
      name: "scene",
      source: "runtime",
      stability: "event",
      included: input.scene.enabled,
    },
    {
      name: "memory",
      source: "continuity",
      stability: "turn",
      included:
        input.continuityMemory.evidenceCandidates.length > 0 ||
        input.continuityMemory.eventCandidates.length > 0 ||
        (input.continuityMemory.styleExamples?.length ?? 0) > 0,
    },
    {
      name: "workflow",
      source: "runtime",
      stability: "turn",
      included: input.workflow.execution.executions.length > 0 || input.workflow.todos.items.length > 0,
    },
    {
      name: "task",
      source: "request",
      stability: "turn",
      included: input.rootCommand !== null || input.toolCards.length > 0,
    },
  ];
}

function stableRoleplayPreset(input: AgentRoleplayPresetContext): AgentRoleplayPresetContext {
  if (!input.card) return input;
  return {
    ...input,
    card: {
      ...input.card,
      lore: [],
    },
  };
}
