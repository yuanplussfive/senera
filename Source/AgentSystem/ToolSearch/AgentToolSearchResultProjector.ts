import { z } from "zod";
import { AgentToolDisclosureLevels, type AgentDisclosedToolSearchResult } from "./AgentToolDisclosurePlanner.js";
import type { ToolSearchArguments } from "./AgentToolSearchToolProtocol.js";

const ToolSearchResultDisclosureSchema = z.object({
  tools: z.object({
    item: z.array(
      z.object({
        name: z.string().trim().min(1),
        disclosure: z.enum([
          AgentToolDisclosureLevels.Reference,
          AgentToolDisclosureLevels.Preview,
          AgentToolDisclosureLevels.Callable,
        ]),
      }),
    ),
  }),
});

export function buildToolSearchResultProjection(
  args: ToolSearchArguments,
  results: readonly AgentDisclosedToolSearchResult[],
) {
  return {
    query: args.query,
    preferredSources: {
      item: args.preferredSources ?? [],
    },
    tools: {
      item: results.map((result) => ({
        name: result.toolName,
        title: result.title,
        disclosure: result.disclosure,
        sources: {
          item: result.sources,
        },
        summary: result.summary,
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
        ...previewFields(result),
      })),
    },
    guidance:
      results.length > 0
        ? "仅 disclosure=callable 的工具已加载完整调用契约，可以直接调用。preview/reference 是候选信息；如需调用，请用准确工具名再次搜索以提升披露级别。"
        : "没有找到匹配工具；换更具体的任务、对象、路径、错误文本或能力关键词重新搜索。",
  };
}

export function readToolNamesFromSearchResult(result: unknown): string[] {
  const parsed = ToolSearchResultDisclosureSchema.safeParse(result);
  return parsed.success
    ? parsed.data.tools.item
        .filter((entry) => entry.disclosure === AgentToolDisclosureLevels.Callable)
        .map((entry) => entry.name)
    : [];
}

function previewFields(result: AgentDisclosedToolSearchResult) {
  return result.disclosure === AgentToolDisclosureLevels.Reference
    ? {}
    : {
        whenToUse: result.whenToUse,
        parameters: result.parameterSummary,
      };
}

function renderSearchReason(result: AgentDisclosedToolSearchResult): string {
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
