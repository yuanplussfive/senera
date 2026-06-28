import { z } from "zod";
import type { ToolLearningResult as BamlToolLearningResult } from "../BamlClient/baml_client/types.js";
import { parseNormalizedBamlOutput } from "../BamlClient/AgentBamlOutputNormalizer.js";
import { AgentActionPlannerValidationError } from "../ActionPlanner/AgentActionPlannerSchema.js";

const NonEmptyStringSchema = z.string().trim().min(1);
const StringListSchema = z.array(NonEmptyStringSchema).transform(uniqueTrimmed);

const ToolLearningResultSchema = z
  .object({
    records: z.array(z.object({
      toolName: NonEmptyStringSchema,
      tags: StringListSchema,
      sourceTerms: StringListSchema,
      triggers: StringListSchema,
      reason: NonEmptyStringSchema,
      confidence: z.number().min(0).max(1),
    }).strict()),
  })
  .strict();

export type ParsedToolLearningResult = z.infer<typeof ToolLearningResultSchema>;

export function parseToolLearningResult(
  result: BamlToolLearningResult,
  options: {
    selectedTools: readonly string[];
    candidateSourceTerms: readonly string[];
    toolTagCatalogByTool: ReadonlyMap<string, ReadonlySet<string>>;
  },
): ParsedToolLearningResult {
  const parsed = parseNormalizedBamlOutput(ToolLearningResultSchema, result);
  const selectedTools = new Set(options.selectedTools);
  const sourceTerms = new Set(options.candidateSourceTerms);
  const issues: string[] = [];

  parsed.records.forEach((record, index) => {
    if (!selectedTools.has(record.toolName)) {
      issues.push(`records.${index}.toolName: 不在 selectedTools 中：${record.toolName}`);
      return;
    }

    const allowedTags = options.toolTagCatalogByTool.get(record.toolName) ?? new Set<string>();
    record.tags.forEach((tag, tagIndex) => {
      if (!allowedTags.has(tag)) {
        issues.push(`records.${index}.tags.${tagIndex}: 标签不属于 ${record.toolName}：${tag}`);
      }
    });

    record.sourceTerms.forEach((term, termIndex) => {
      if (!sourceTerms.has(term)) {
        issues.push(`records.${index}.sourceTerms.${termIndex}: 源词不在 candidateSourceTerms 中：${term}`);
      }
    });
  });

  if (issues.length > 0) {
    throw new AgentActionPlannerValidationError(issues, parsed);
  }

  return parsed;
}

function uniqueTrimmed(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
