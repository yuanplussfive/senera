import { z } from "zod";
import type { ToolSearchArguments } from "./AgentToolMetaToolProtocol.js";
import type { AgentToolSearchResult } from "./AgentToolSearchTypes.js";

const ToolSearchResultSchema = z.object({
  tools: z.object({
    item: z.array(
      z.object({
        name: z.string().trim().min(1),
        confidence: z.number().optional(),
        state: z
          .object({
            exposure: z.enum(["visible", "discoverable"]),
            contract: z.enum(["unconfirmed", "confirmed"]),
            reuse: z.enum(["none", "arguments"]),
            reusableArguments: z.record(z.string(), z.unknown()).optional(),
          })
          .optional(),
      }),
    ),
  }),
});

export function buildToolSearchResultProjection(args: ToolSearchArguments, results: readonly AgentToolSearchResult[]) {
  const matchedResults = results.filter(hasMatchEvidence);
  const bestScore = matchedResults[0]?.score ?? 0;
  const reusable = results.some((result) => result.state?.reuse === "arguments");
  return {
    query: args.query,
    catalogRevision: "",
    preferredSources: { item: args.preferredSources ?? [] },
    tools: {
      item: results.map((result, index) => projectToolSearchEntry(result, index, bestScore)),
    },
    guidance:
      matchedResults.length > 0
        ? reusable
          ? "候选仅用于发现。标记为 confirmed/arguments 的工具已经有可复用参数；保持参数不变时直接调用。其它工具先调用 ToolDescribe 读取准确契约与副作用，再按需加载。"
          : "候选仅用于发现。先调用 ToolDescribe 读取准确参数契约与副作用，再使用当前运行时提供的工具调用入口；若入口要求加载，则先加载。"
        : results.length > 0
          ? "没有直接匹配候选；以下仍列出当前授权范围内可发现的动态工具目录，请选择后调用 ToolDescribe。"
          : "没有可发现的动态工具。",
  };
}

export function withToolSearchCatalogRevision<T extends Record<string, unknown>>(
  projection: T,
  catalogRevision: string,
): T & { catalogRevision: string } {
  return { ...projection, catalogRevision };
}

export function readToolNamesFromSearchResult(result: unknown): string[] {
  const parsed = ToolSearchResultSchema.safeParse(result);
  return parsed.success
    ? parsed.data.tools.item.filter((entry) => (entry.confidence ?? 0) > 0).map((entry) => entry.name)
    : [];
}

function projectToolSearchEntry(result: AgentToolSearchResult, index: number, bestScore: number) {
  const confidence = hasMatchEvidence(result) ? normalizeConfidence(result.score, bestScore) : 0;
  const base = {
    name: result.toolName,
    title: result.title,
    summary: result.summary,
    rank: index + 1,
    confidence,
    ...(result.state ? { state: result.state } : {}),
  };

  if (confidence <= 0) return base;

  return {
    ...base,
    sources: {
      item: result.sources.map((source) => ({ id: source.id, title: source.title })),
    },
    matches: {
      terms: { item: result.matchedTerms },
      capabilities: {
        item: result.matchedCapabilities.map((capability) => ({
          id: capability.id,
          title: capability.title,
          facets: { item: capability.matchedFacets },
        })),
      },
    },
  };
}

function hasMatchEvidence(result: AgentToolSearchResult): boolean {
  return ["bm25", "exact", "fuzzy", "semantic", "memory"].some((ranker) => result.ranks[ranker] !== undefined);
}

function normalizeConfidence(score: number, bestScore: number): number {
  if (bestScore <= 0 || score <= 0) return 0;
  return Number(Math.min(1, score / bestScore).toFixed(3));
}
