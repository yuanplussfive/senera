import type { probeAgentDocument } from "./AgentDocumentProbe.js";
import type { AgentDocumentProbeResult } from "./AgentDocumentProbeTypes.js";
import type {
  AgentDocumentExtractOptions,
  AgentDocumentExtractResult,
} from "./AgentDocumentExtractTypes.js";

export interface AgentDocumentExtractInput {
  filePath: string;
  name: string;
  declaredMime?: string;
  size: number;
  sha256?: string;
  uploadUri?: string;
  extractors: Record<string, AgentDocumentExtractorConfig>;
  probe: Parameters<typeof probeAgentDocument>[1];
  signal?: AbortSignal;
}

export interface AgentDocumentExtractorConfig {
  type: string;
  enabled: boolean;
  priority: number;
  [key: string]: unknown;
}

export interface AgentDocumentExtractorMatcher {
  mimes?: string[];
  mimePrefixes?: string[];
  extensions?: string[];
  mediaTypes?: string[];
  isText?: boolean;
  isBinary?: boolean;
  containerFormats?: string[];
}

export interface AgentDocumentExtractorSelection<TData = unknown> {
  name: string;
  config: AgentDocumentExtractorConfig;
  data?: TData;
}

export interface AgentDocumentExtractorMatchInput {
  name: string;
  config: AgentDocumentExtractorConfig;
  probe: AgentDocumentProbeResult;
}

export interface AgentDocumentExtractorRunInput<TData = unknown> {
  input: AgentDocumentExtractInput;
  options: AgentDocumentExtractOptions;
  probe: AgentDocumentProbeResult;
  selection: AgentDocumentExtractorSelection<TData>;
}

export interface AgentDocumentExtractorHandler<TData = unknown> {
  type: string;
  select(input: AgentDocumentExtractorMatchInput): AgentDocumentExtractorSelection<TData> | undefined;
  extract(input: AgentDocumentExtractorRunInput<TData>): Promise<AgentDocumentExtractResult>;
}
