import { z } from "zod";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import {
  resolveMemoryLearningConfig,
  resolveModelProviderConfig,
  resolveToolLearningConfig,
  resolveVectorModelsConfig,
} from "../AgentDefaults.js";
import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import {
  normalizeToolArrayArgument,
  normalizeToolNumberArgument,
  normalizeToolStringArgument,
} from "../ToolRuntime/AgentToolArgumentNormalization.js";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessRunner.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentVectorModelClient } from "../Vector/AgentVectorModelClient.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import {
  AgentMemoryTypes,
  DefaultAgentMemoryDatabasePath,
  resolveAgentMemoryDatabasePath,
  SqliteAgentMemorySourceRepository,
  type AgentMemoryConsolidationActionRecord,
  type AgentMemoryDirectWriteInput,
  type AgentMemoryDirectWriteOperation,
  type AgentMemoryItemRecord,
  type AgentMemorySourceRepository,
} from "./AgentMemorySourceRepository.js";
import { memoryItemEmbeddingText } from "./AgentMemoryText.js";
import { AgentMemoryWriteResolver } from "./AgentMemoryWriteResolver.js";
import type { AgentMemoryWriteResolutionRequest, AgentMemoryWriteResolverOptions } from "./AgentMemoryWriteResolver.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

const MemoryWriteOperations = ["create", "reinforce", "update", "supersede"] as const;

const StringArraySchema = z.preprocess(normalizeToolArrayArgument, z.array(z.string().trim().min(1)).min(1));

const MemoryWriteArgumentsSchema = z
  .object({
    operation: z.enum(MemoryWriteOperations).optional(),
    type: z.enum(AgentMemoryTypes),
    subject: z.preprocess(normalizeToolStringArgument, z.string().trim().min(1)),
    claim: z.preprocess(normalizeToolStringArgument, z.string().trim().min(1)),
    howToApply: z.preprocess(normalizeToolStringArgument, z.string().trim().min(1)),
    tags: StringArraySchema,
    triggers: StringArraySchema,
    confidence: z.preprocess(normalizeToolNumberArgument, z.number().min(0).max(1)),
    targetMemoryUri: z.preprocess(normalizeOptionalString, z.string().trim().min(1)).optional(),
    reason: z.preprocess(normalizeOptionalString, z.string().trim().min(1)).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.operation === "reinforce" || value.operation === "update" || value.operation === "supersede") &&
      !value.targetMemoryUri
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetMemoryUri"],
        message: "reinforce/update/supersede operation requires targetMemoryUri.",
      });
    }
  });

export type MemoryWriteToolArguments = z.infer<typeof MemoryWriteArgumentsSchema>;

interface MemoryWriteResultItem {
  memoryUri: string;
  operation: AgentMemoryDirectWriteOperation;
  type: string;
  subject: string;
  claim: string;
  howToApply: string;
  tags: { item: string[] };
  triggers: { item: string[] };
  sourceRefs: { item: string[] };
  status: string;
  confidence: number;
  targetMemoryUri: string;
  updatedAt: string;
  localDate: string;
}

export interface MemoryWriteResult {
  status: "written" | "skipped";
  memories: {
    item: MemoryWriteResultItem[];
  };
  warnings: {
    item: string[];
  };
  guidance: string;
}

/** The model-mediated decision is a runtime boundary, not a repository concern. */
export interface AgentMemoryWriteDecisionResolver {
  resolve(input: AgentMemoryWriteResolutionRequest): Promise<AgentMemoryConsolidationActionRecord>;
}

export type AgentMemoryWriteDecisionResolverFactory = (
  options: AgentMemoryWriteResolverOptions,
) => AgentMemoryWriteDecisionResolver;

export interface AgentMemoryWriteOptions {
  repository: AgentMemorySourceRepository;
  config: AgentSystemConfig;
  requestId?: string;
  signal?: AbortSignal;
  createDecisionResolver?: AgentMemoryWriteDecisionResolverFactory;
}

export const writeMemoryHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = MemoryWriteArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return memoryWriteFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "MemoryWriteTool 参数无效。",
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => (typeof entry === "number" ? entry : String(entry))),
      })),
    });
  }

  const repository = new SqliteAgentMemorySourceRepository(
    resolveAgentMemoryDatabasePath(context.workspaceRoot, DefaultAgentMemoryDatabasePath),
  );
  try {
    throwIfAborted(context.signal);
    return okMemoryWriteResult(
      await writeAgentMemory(parsed.data, {
        repository,
        config: context.config,
        requestId: context.requestId,
        signal: context.signal,
      }),
    );
  } catch (error) {
    return memoryWriteFailure({
      code: AgentExecutionErrorCodes.PluginExecutionError,
      message: error instanceof Error ? error.message : String(error),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: context.tool.name,
      },
    });
  } finally {
    repository.close();
  }
};

export async function writeAgentMemory(
  args: MemoryWriteToolArguments,
  options: AgentMemoryWriteOptions,
): Promise<MemoryWriteResult> {
  const operation = args.operation ?? "create";
  const decision = await resolveDirectMemoryWrite(args, operation, options);
  if (decision.operation === "reject") {
    return {
      status: "skipped",
      memories: {
        item: [],
      },
      warnings: {
        item: [],
      },
      guidance: "Memory write was rejected because it was not suitable as active long-term memory.",
    };
  }

  const item = options.repository.writeDirectMemory({
    operation: decision.operation,
    type: decision.type,
    subject: decision.subject,
    claim: decision.claim,
    howToApply: decision.howToApply,
    tags: decision.tags,
    triggers: decision.triggers,
    confidence: decision.confidence,
    targetMemoryUri: decision.targetMemoryUri,
    reason: decision.reason,
    requestId: options.requestId,
  } satisfies AgentMemoryDirectWriteInput);
  const warnings = await writeMemoryEmbedding(item, options)
    .then(() => [])
    .catch((error) => [`memory embedding skipped: ${readErrorMessage(error)}`]);

  return {
    status: "written",
    memories: {
      item: [projectMemoryWriteResult(item, decision.operation, decision.targetMemoryUri)],
    },
    warnings: {
      item: warnings,
    },
    guidance: "Memory was written as active long-term memory. Future MemoryRecallTool calls can retrieve it.",
  };
}

async function resolveDirectMemoryWrite(
  args: MemoryWriteToolArguments,
  operation: AgentMemoryDirectWriteOperation,
  options: AgentMemoryWriteOptions,
): Promise<AgentMemoryConsolidationActionRecord> {
  const proposed = directMemoryWriteProposedAction(args, operation);
  const hasComparableMemory = options.repository.listActiveMemoryItems().some((item) => item.type === args.type);
  if (operation !== "create" || !hasComparableMemory) {
    return proposed;
  }

  const learningConfig = resolveToolLearningConfig(options.config);
  const memoryLearningConfig = resolveMemoryLearningConfig(options.config);
  const vectorConfig = resolveVectorModelsConfig(options.config);
  const resolverOptions = {
    repository: options.repository,
    client: new AgentActionPlannerModelClient(resolveModelProviderConfig(options.config), learningConfig.Client, {
      maxRepairAttempts: learningConfig.MaxRepairAttempts,
    }),
    vectorClient: new AgentVectorModelClient(vectorConfig),
    memoryLearningConfig,
    embeddingModel: vectorConfig.Embedding.Model,
    maxRepairAttempts: learningConfig.MaxRepairAttempts,
  } satisfies AgentMemoryWriteResolverOptions;
  const resolver = (options.createDecisionResolver ?? createAgentMemoryWriteDecisionResolver)(resolverOptions);
  return resolver.resolve({
    source: "direct_tool",
    requestId: options.requestId ?? "",
    standaloneRequest: args.claim,
    proposed,
    signal: options.signal,
  });
}

function directMemoryWriteProposedAction(
  args: MemoryWriteToolArguments,
  operation: AgentMemoryDirectWriteOperation,
): AgentMemoryConsolidationActionRecord {
  return {
    operation,
    type: args.type,
    subject: args.subject,
    claim: args.claim,
    howToApply: args.howToApply,
    tags: args.tags,
    triggers: args.triggers,
    sourceRefs: [],
    candidateUris: [],
    targetMemoryUri: args.targetMemoryUri,
    reason: args.reason ?? "Explicit memory write tool call.",
    confidence: args.confidence,
  };
}

async function writeMemoryEmbedding(
  item: AgentMemoryItemRecord,
  options: Pick<AgentMemoryWriteOptions, "repository" | "config" | "signal">,
): Promise<void> {
  const vectorConfig = resolveVectorModelsConfig(options.config);
  if (!vectorConfig.Embedding.Enabled) {
    return;
  }

  const result = await new AgentVectorModelClient(vectorConfig).embed({
    input: [memoryItemEmbeddingText(item)],
    signal: options.signal,
  });
  const embedding = result.vectors[0];
  if (!embedding) {
    return;
  }

  options.repository.upsertMemoryItemVectors([
    {
      memoryUri: item.uri,
      model: result.model,
      embedding,
      updatedAt: item.updatedAt,
    },
  ]);
}

function createAgentMemoryWriteDecisionResolver(
  options: AgentMemoryWriteResolverOptions,
): AgentMemoryWriteDecisionResolver {
  return new AgentMemoryWriteResolver(options);
}

function projectMemoryWriteResult(
  item: AgentMemoryItemRecord,
  operation: AgentMemoryDirectWriteOperation,
  targetMemoryUri: string | undefined,
): MemoryWriteResultItem {
  return {
    memoryUri: item.uri,
    operation,
    type: item.type,
    subject: item.subject,
    claim: item.claim,
    howToApply: item.howToApply,
    tags: { item: item.tags },
    triggers: { item: item.triggers },
    sourceRefs: { item: item.sourceRefs },
    status: item.status,
    confidence: Number(item.confidence.toFixed(6)),
    targetMemoryUri: targetMemoryUri ?? "",
    updatedAt: item.updatedAt,
    localDate: item.localDate,
  };
}

function normalizeOptionalString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}

function okMemoryWriteResult(result: unknown): AgentToolProcessRunResult {
  return toolProcessSuccessResult(result);
}

function memoryWriteFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}
