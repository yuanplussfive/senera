import type { AgentActionCapabilityNeed } from "../ActionPlanner/AgentActionPlanner.js";

export interface PlannedToolSearchQuery {
  text: string;
  facets: string[];
}

export function buildPlannedToolSearchQueries(
  options: {
    input: string;
    queries?: readonly string[];
    needs?: readonly AgentActionCapabilityNeed[];
    discover?: boolean;
  },
  tokenize: (text: string) => string[],
): PlannedToolSearchQuery[] {
  if (!options.discover && (options.queries ?? []).length === 0) {
    return [];
  }

  const needTexts = (options.needs ?? []).map(capabilityNeedText).filter(Boolean);
  const facets = uniqueNonEmpty(needTexts.flatMap((text) => tokenize(text)));
  return uniqueNonEmpty([
    ...(options.queries ?? []),
    ...needTexts,
  ]).map((text) => ({
    text,
    facets,
  }));
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function capabilityNeedText(need: AgentActionCapabilityNeed): string {
  return [
    ...need.actions,
    ...need.targets,
    ...need.inputs,
    ...need.outputs,
    ...need.evidence,
    ...need.effects,
  ].join(" ");
}
