import type { SupportedFileType } from "officeparser";

export interface AgentDocumentExtractOptions {
  parse: {
    ocr: boolean;
    extractAttachments: boolean;
    includeRawContent: boolean;
    ignoreNotes: boolean;
    ignoreComments: boolean;
    ignoreHeadersAndFooters: boolean;
    ignoreSlideMasters: boolean;
    ignoreInternalLinks: boolean;
    newlineDelimiter: string;
  };
  output: {
    maxFileBytes: number;
    maxTextChars: number;
    maxMarkdownChars: number;
    maxChunks: number;
    maxChunkChars: number;
  };
}

export interface AgentDocumentExtractResult {
  status: "extracted";
  parser: "officeparser";
  fileType: SupportedFileType;
  textPreview: string;
  markdownPreview: string;
  textLength: number;
  markdownLength: number;
  metadata: Record<string, unknown>;
  structure: {
    topLevelNodeCount: number;
    attachmentCount: number;
    warningCount: number;
  };
  chunks: AgentDocumentExtractChunk[];
  warnings: AgentDocumentExtractWarning[];
}

export interface AgentDocumentExtractChunk {
  index: number;
  text: string;
  length: number;
  metadata?: Record<string, unknown>;
}

export interface AgentDocumentExtractWarning {
  type: "warning" | "info" | "error";
  code: string;
  message: string;
}
