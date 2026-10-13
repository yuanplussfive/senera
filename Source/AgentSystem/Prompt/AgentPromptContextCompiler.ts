import type { AgentRootCommand } from "../AgentRootCommand.js";
import { EmptyAgentPersonaContext, type AgentPersonaContext } from "./AgentPersonaContext.js";
import type { AgentContinuityMemoryPromptContext } from "../Continuity/AgentContinuityMemoryTypes.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentExecutionEnvironmentContext } from "./AgentExecutionEnvironmentContext.js";
import type { AgentPromptContext, AgentPromptToolContext } from "./AgentPromptContextTypes.js";
import type { AgentWorkflowPromptContext } from "./AgentWorkflowPromptContext.js";
import type {
  AgentPromptContextLayerManifestEntry,
  AgentPromptContextRevisions,
} from "./AgentPromptContextLayerTypes.js";

export interface AgentPromptContextCompilerInput {
  readonly executionEnvironment: AgentExecutionEnvironmentContext;
  readonly toolCards: readonly AgentPromptToolContext[];
  readonly toolDiscoveryToolName: string | null;
  readonly rootCommand: AgentRootCommand | null;
  readonly persona?: AgentPersonaContext;
  readonly continuityMemory: AgentContinuityMemoryPromptContext;
  readonly workflow: AgentWorkflowPromptContext;
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
    Persona: input.persona ?? EmptyAgentPersonaContext,
    ContinuityMemory: input.continuityMemory,
    Workflow: input.workflow,
    ContextLayers: buildLayerManifest(input),
    ContextRevisions: buildContextRevisions(input),
  };
}

function buildContextRevisions(input: AgentPromptContextCompilerInput): AgentPromptContextRevisions {
  return {
    stable: sha256HexOfCanonicalJson({
      executionEnvironment: input.executionEnvironment,
      persona: input.persona ?? EmptyAgentPersonaContext,
    }),
    context: sha256HexOfCanonicalJson({
      toolCards: input.toolCards,
      toolDiscoveryToolName: input.toolDiscoveryToolName,
    }),
    volatile: sha256HexOfCanonicalJson({
      rootCommand: input.rootCommand,
      workflow: input.workflow,
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
      source: "runtime",
      stability: "stable",
      included: (input.persona ?? EmptyAgentPersonaContext).enabled,
    },
    {
      name: "memory",
      source: "continuity",
      stability: "turn",
      included: input.continuityMemory.eventCandidates.length > 0 || input.continuityMemory.periodDigests.length > 0,
    },
    {
      name: "workflow",
      source: "runtime",
      stability: "turn",
      included:
        input.workflow.execution.executions.length > 0 ||
        input.workflow.todos.items.length > 0 ||
        input.workflow.delegation.runs.length > 0,
    },
    {
      name: "task",
      source: "request",
      stability: "turn",
      included: input.rootCommand !== null || input.toolCards.length > 0,
    },
  ];
}
