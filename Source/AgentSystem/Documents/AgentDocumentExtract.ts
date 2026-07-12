import { probeAgentDocument } from "./AgentDocumentProbe.js";
import type { AgentDocumentProbeResult } from "./AgentDocumentProbeTypes.js";
import type { AgentDocumentExtractOptions, AgentDocumentExtractResult } from "./AgentDocumentExtractTypes.js";
import {
  DefaultAgentDocumentExtractorRegistry,
  type AgentDocumentExtractorRegistry,
} from "./AgentDocumentExtractorRegistry.js";
import type {
  AgentDocumentExtractInput,
  AgentDocumentExtractorConfig,
  AgentDocumentExtractorSelection,
} from "./AgentDocumentExtractorTypes.js";

export type {
  AgentDocumentExtractInput,
  AgentDocumentExtractorConfig,
  AgentDocumentExtractorMatcher,
  AgentDocumentExtractorSelection,
} from "./AgentDocumentExtractorTypes.js";

export async function extractAgentDocument(
  input: AgentDocumentExtractInput,
  options: AgentDocumentExtractOptions,
  registry: AgentDocumentExtractorRegistry = DefaultAgentDocumentExtractorRegistry,
): Promise<AgentDocumentExtractResult> {
  if (input.size > options.output.maxFileBytes) {
    throw new Error(`文档超过抽取大小限制：${input.size} > ${options.output.maxFileBytes}`);
  }

  const probe = await probeAgentDocument(
    {
      filePath: input.filePath,
      name: input.name,
      declaredMime: input.declaredMime,
      size: input.size,
      sha256: input.sha256,
      uploadUri: input.uploadUri,
    },
    input.probe,
  );
  const selection = selectAgentDocumentExtractor(probe, input.extractors, registry);
  if (!selection) {
    throw new Error(
      `没有匹配的文档抽取器。effectiveMime=${probe.effectiveMime} detectedExtension=${probe.detectedExtension ?? ""} namedExtension=${probe.namedExtension ?? ""}`,
    );
  }

  return registry.extract({
    document: input,
    options,
    probe,
    selection,
  });
}

export function selectAgentDocumentExtractor(
  probe: AgentDocumentProbeResult,
  extractors: Record<string, AgentDocumentExtractorConfig>,
  registry: AgentDocumentExtractorRegistry = DefaultAgentDocumentExtractorRegistry,
): AgentDocumentExtractorSelection | undefined {
  return registry.select(probe, extractors);
}
