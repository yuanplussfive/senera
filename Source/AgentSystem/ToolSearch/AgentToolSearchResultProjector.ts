import type { AgentToolSearchResult } from "./AgentToolSearchIndex.js";
import type { ToolSearchArguments } from "./AgentToolSearchToolProtocol.js";

export function buildToolSearchResultProjection(args: ToolSearchArguments, results: readonly AgentToolSearchResult[]) {
  return {
    query: args.query,
    tools: {
      item: results.map((result) => ({
        name: result.toolName,
        title: result.title,
        summary: result.summary,
        whenToUse: result.whenToUse,
        score: result.score,
        matchedTerms: {
          item: result.matchedTerms,
        },
        permissions: {
          item: result.permissions,
        },
        matchedCapabilities: {
          item: result.matchedCapabilities.map((capability) => ({
            id: capability.id,
            title: capability.title,
            score: capability.score,
            matchedFacets: {
              item: capability.matchedFacets,
            },
            risk: capability.risk,
          })),
        },
        learningSignals: {
          item: result.learningSignals.map((signal) => ({
            term: signal.term,
            source: signal.source,
            support: signal.support,
            confidence: signal.confidence,
            score: signal.score,
          })),
        },
        reason: renderSearchReason(result),
      })),
    },
    guidance:
      results.length > 0
        ? "这些工具会在下一轮提示词中展开完整能力卡片；下一步需要工具时只调用其中最匹配的工具。"
        : "没有找到匹配工具；换更具体的任务、对象、路径、错误文本或能力关键词重新搜索。",
  };
}

export function readToolNamesFromSearchResult(result: unknown): string[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return [];
  }

  const tools = (result as Record<string, unknown>).tools;
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    return [];
  }

  const item = (tools as Record<string, unknown>).item;
  if (!Array.isArray(item)) {
    return [];
  }

  return item.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const name = (entry as Record<string, unknown>).name;
    return typeof name === "string" && name.trim().length > 0 ? [name.trim()] : [];
  });
}

function renderSearchReason(result: AgentToolSearchResult): string {
  const capabilities = result.matchedCapabilities.map((capability) =>
    capability.matchedFacets.length > 0 ? `${capability.id} (${capability.matchedFacets.join(", ")})` : capability.id,
  );
  const terms = result.matchedTerms.length > 0 ? `terms: ${result.matchedTerms.join(", ")}` : "";
  return [
    capabilities.length > 0 ? `capabilities: ${capabilities.join("; ")}` : "",
    terms,
    result.learningSignals.length > 0
      ? `learning: ${result.learningSignals.map((signal) => signal.term).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
}
