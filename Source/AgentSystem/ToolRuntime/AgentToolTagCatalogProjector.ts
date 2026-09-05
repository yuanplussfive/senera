import type { AgentToolCatalogItem } from "./AgentToolCatalogProjector.js";

export class AgentToolTagCatalogProjector {
  project(options: { tools: readonly AgentToolCatalogItem[]; includeSystem?: boolean }): string[] {
    const includeSystem = options.includeSystem ?? false;
    const tags = new Set<string>();

    for (const tool of options.tools) {
      if (tool.rootKind === "System" && !includeSystem) {
        continue;
      }

      for (const tag of tool.tags.map(normalizeTag).filter(Boolean)) {
        tags.add(tag);
      }
    }

    return [...tags].sort((left, right) => left.localeCompare(right));
  }
}

function normalizeTag(value: string): string {
  return value.normalize("NFKC").trim();
}
