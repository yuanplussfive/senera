export interface AgentDocumentProbeInput {
  filePath: string;
  name: string;
  declaredMime?: string;
  size: number;
  sha256?: string;
  uploadUri?: string;
}

export interface AgentDocumentProbeSignal {
  source: string;
  fields: Record<string, unknown>;
}

export interface AgentDocumentProbeResult {
  status: "probed";
  effectiveMime: string;
  detectedMime?: string;
  detectedExtension?: string;
  declaredMime?: string;
  namedMime?: string;
  namedExtension?: string;
  mediaType?: string;
  charset?: string;
  isText?: boolean;
  isBinary?: boolean;
  container?: AgentDocumentContainerProbeResult;
  signals: AgentDocumentProbeSignal[];
  file: {
    name: string;
    size: number;
    sha256?: string;
    uploadUri?: string;
  };
}

export interface AgentDocumentContainerProbeResult {
  format: "zip";
  entryCount: number;
  sampledEntries: string[];
  contentTypes?: AgentDocumentContentTypesProbeResult;
}

export interface AgentDocumentContentTypesProbeResult {
  entryName: string;
  defaults: AgentDocumentContentTypeDefault[];
  overrides: AgentDocumentContentTypeOverride[];
}

export interface AgentDocumentContentTypeDefault {
  extension: string;
  contentType: string;
}

export interface AgentDocumentContentTypeOverride {
  partName: string;
  contentType: string;
}
