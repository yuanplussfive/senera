import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessRunner.js";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import {
  toolProcessFailureResult,
  toolProcessSuccessResult,
} from "../ToolRuntime/AgentToolProcessEnvelope.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "../Xml/AgentXmlStatus.js";
import {
  DefaultAgentMemoryDatabasePath,
  resolveAgentMemoryDatabasePath,
  SqliteAgentMemorySourceRepository,
} from "./AgentMemorySourceRepository.js";
import {
  recallConversationTurns,
} from "./AgentMemoryConversationRecall.js";
import {
  exactRefMemoryRanking,
  fuseMemoryRankings,
  keywordMemoryRanking,
  rerankMemories,
  scopedMemoryItems,
  semanticMemoryRanking,
} from "./AgentMemoryRecallRanker.js";
import {
  fallbackReason,
  memoryRecallGuidance,
  projectMemoryResult,
  projectSourceResult,
} from "./AgentMemoryRecallProjector.js";
import {
  MemoryRecallArgumentsSchema,
  MemoryRecallPolicy,
  type MemoryRecallOptions,
  type MemoryRecallRanking,
  type MemoryRecallResult,
  type MemoryRecallToolArguments,
} from "./AgentMemoryRecallTypes.js";
import {
  readErrorMessage,
  unique,
} from "./AgentMemoryRecallUtils.js";

export type {
  MemoryRecallOptions,
  MemoryRecallResult,
  MemoryRecallScope,
  MemoryRecallToolArguments,
} from "./AgentMemoryRecallTypes.js";

export const recallMemoryHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = MemoryRecallArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return memoryRecallFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "MemoryRecallTool 参数无效。",
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => typeof entry === "number" ? entry : String(entry)),
      })),
    });
  }

  const repository = new SqliteAgentMemorySourceRepository(
    resolveAgentMemoryDatabasePath(context.workspaceRoot, DefaultAgentMemoryDatabasePath),
  );
  try {
    throwIfAborted(context.signal);
    return okMemoryRecallResult(await recallAgentMemories(parsed.data, {
      repository,
      config: context.config,
      signal: context.signal,
    }));
  } catch (error) {
    return memoryRecallFailure({
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

export async function recallAgentMemories(
  args: MemoryRecallToolArguments,
  options: MemoryRecallOptions,
): Promise<MemoryRecallResult> {
  const limit = args.limit ?? MemoryRecallPolicy.defaultLimit;
  const candidateLimit = Math.max(
    limit * MemoryRecallPolicy.candidateMultiplier,
    MemoryRecallPolicy.minimumCandidatePool,
  );
  const refs = unique(args.refs ?? []);
  const scope = args.scope ?? "all";
  const warnings: string[] = [];
  const items = scopedMemoryItems(options.repository.listActiveMemoryItems(), scope);
  const itemsByUri = new Map(items.map((item) => [item.uri, item]));
  const exactSources = refs.length > 0
    ? options.repository.findMemorySourcesByRefs(refs)
    : [];

  const initialRankings: MemoryRecallRanking[] = [
    {
      name: "exact_ref",
      entries: exactRefMemoryRanking({
        refs,
        sources: exactSources,
        items,
        directItems: options.repository.findMemoryItemsByUris(refs)
          .filter((item) => itemsByUri.has(item.uri)),
      }),
    },
    {
      name: "keyword",
      entries: keywordMemoryRanking(args.query, items),
    },
  ];

  const semantic = await semanticMemoryRanking(args.query, items, options)
    .catch((error) => {
      warnings.push(`semantic recall unavailable: ${readErrorMessage(error)}`);
      return [];
    });
  initialRankings.push({
    name: "semantic",
    entries: semantic,
  });

  const candidateUris = fuseMemoryRankings(initialRankings, candidateLimit)
    .map((entry) => entry.memoryUri);
  const reranked = await rerankMemories(args.query, candidateUris, itemsByUri, options)
    .catch((error) => {
      warnings.push(`memory rerank unavailable: ${readErrorMessage(error)}`);
      return [];
    });

  const ranked = fuseMemoryRankings([
    ...initialRankings,
    {
      name: "rerank",
      entries: reranked,
    },
  ], limit);
  const results = ranked.flatMap((entry) => {
    const item = itemsByUri.get(entry.memoryUri);
    return item
      ? [projectMemoryResult(item, entry)]
      : [];
  });
  const turns = results.length === 0
    ? await recallConversationTurns({
      query: args.query,
      refs,
      limit,
      candidateLimit,
      exactSources,
      options,
    }).catch((error) => {
      warnings.push(`conversation recall unavailable: ${readErrorMessage(error)}`);
      return [];
    })
    : [];
  const returnedSourceRefs = unique([
    ...results.flatMap((entry) => entry.sourceRefs.item),
    ...turns.flatMap((entry) => entry.sourceRefs.item),
  ]);
  const returnedSources = returnedSourceRefs.length > 0
    ? options.repository.findMemorySourcesByRefs(returnedSourceRefs).map(projectSourceResult)
    : [];
  const fallback = {
    used: results.length === 0,
    reason: fallbackReason(results, turns),
  };

  return {
    query: args.query,
    scope,
    limit,
    refs: { item: refs },
    memories: { item: results },
    turns: { item: turns },
    sources: { item: returnedSources },
    fallback,
    warnings: { item: warnings },
    guidance: memoryRecallGuidance(results, turns),
  };
}

function okMemoryRecallResult(result: unknown): AgentToolProcessRunResult {
  return toolProcessSuccessResult(result);
}

function memoryRecallFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}
