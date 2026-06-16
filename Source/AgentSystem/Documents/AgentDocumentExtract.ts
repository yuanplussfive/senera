import { OfficeParser, type OfficeChunk, type SupportedFileType } from "officeparser";
import { probeAgentDocument } from "./AgentDocumentProbe.js";
import type { AgentDocumentProbeResult } from "./AgentDocumentProbeTypes.js";
import type {
  AgentDocumentExtractChunk,
  AgentDocumentExtractOptions,
  AgentDocumentExtractResult,
  AgentDocumentExtractWarning,
} from "./AgentDocumentExtractTypes.js";

type OfficeIssueLike = {
  type: "warning" | "info" | "error";
  code: unknown;
  message: string;
};

export interface AgentDocumentExtractInput {
  filePath: string;
  name: string;
  declaredMime?: string;
  size: number;
  sha256?: string;
  uploadUri?: string;
  fileTypes: Record<string, {
    mimes?: string[];
    extensions?: string[];
  }>;
  probe: Parameters<typeof probeAgentDocument>[1];
  signal?: AbortSignal;
}

export async function extractAgentDocument(
  input: AgentDocumentExtractInput,
  options: AgentDocumentExtractOptions,
): Promise<AgentDocumentExtractResult> {
  if (input.size > options.output.maxFileBytes) {
    throw new Error(`文档超过抽取大小限制：${input.size} > ${options.output.maxFileBytes}`);
  }

  const probe = await probeAgentDocument({
    filePath: input.filePath,
    name: input.name,
    declaredMime: input.declaredMime,
    size: input.size,
    sha256: input.sha256,
    uploadUri: input.uploadUri,
  }, input.probe);
  const fileType = selectOfficeParserFileType(probe, input.fileTypes);
  const warnings: OfficeIssueLike[] = [];
  const ast = await OfficeParser.parseOffice(input.filePath, {
    fileType,
    abortSignal: input.signal ?? null,
    onWarning: (issue) => warnings.push(issue),
    newlineDelimiter: options.parse.newlineDelimiter,
    ignoreNotes: options.parse.ignoreNotes,
    ignoreComments: options.parse.ignoreComments,
    ignoreHeadersAndFooters: options.parse.ignoreHeadersAndFooters,
    ignoreSlideMasters: options.parse.ignoreSlideMasters,
    ignoreInternalLinks: options.parse.ignoreInternalLinks,
    extractAttachments: options.parse.extractAttachments,
    includeRawContent: options.parse.includeRawContent,
    ocr: options.parse.ocr,
  });

  const text = String((await ast.to("text")).value);
  const markdownResult = await ast.to("md");
  const markdown = String(markdownResult.value);
  const chunkResult = options.output.maxChunks > 0 ? await ast.to("chunks") : undefined;
  const chunks = Array.isArray(chunkResult?.value)
    ? projectChunks(chunkResult.value, options)
    : [];

  return {
    status: "extracted",
    parser: "officeparser",
    fileType: ast.type,
    textPreview: limitText(text, options.output.maxTextChars),
    markdownPreview: limitText(markdown, options.output.maxMarkdownChars),
    textLength: text.length,
    markdownLength: markdown.length,
    metadata: toJsonObject(ast.metadata),
    structure: {
      topLevelNodeCount: ast.content.length,
      attachmentCount: ast.attachments.length,
      warningCount: [
        ...warnings,
        ...ast.warnings,
        ...markdownResult.messages,
        ...(chunkResult?.messages ?? []),
      ].length,
    },
    chunks,
    warnings: projectWarnings([
      ...warnings,
      ...ast.warnings,
      ...markdownResult.messages,
      ...(chunkResult?.messages ?? []),
    ]),
  };
}

export function selectOfficeParserFileType(
  probe: AgentDocumentProbeResult,
  fileTypes: AgentDocumentExtractInput["fileTypes"],
): SupportedFileType {
  const mimes = new Set([
    probe.effectiveMime,
    probe.detectedMime,
    probe.declaredMime,
    probe.namedMime,
  ].flatMap((value) => normalizeToken(value) ? [normalizeToken(value)] : []));
  const extensions = new Set([
    probe.detectedExtension,
    probe.namedExtension,
  ].flatMap((value) => normalizeToken(value) ? [normalizeToken(value)] : []));

  for (const [fileType, selectors] of Object.entries(fileTypes)) {
    if (selectors.mimes?.some((mime) => mimes.has(normalizeToken(mime) ?? ""))) {
      return fileType as SupportedFileType;
    }
    if (selectors.extensions?.some((extension) => extensions.has(normalizeExtension(extension) ?? ""))) {
      return fileType as SupportedFileType;
    }
  }

  throw new Error(`没有匹配的 officeparser fileType。effectiveMime=${probe.effectiveMime} detectedExtension=${probe.detectedExtension ?? ""} namedExtension=${probe.namedExtension ?? ""}`);
}

function projectChunks(
  chunks: OfficeChunk[],
  options: AgentDocumentExtractOptions,
): AgentDocumentExtractChunk[] {
  return chunks.slice(0, options.output.maxChunks).map((chunk, index) => ({
    index,
    text: limitText(chunk.text, options.output.maxChunkChars),
    length: chunk.text.length,
    metadata: toJsonObject(chunk.metadata),
  }));
}

function projectWarnings(warnings: OfficeIssueLike[]): AgentDocumentExtractWarning[] {
  return warnings.map((warning) => ({
    type: warning.type,
    code: String(warning.code),
    message: warning.message,
  }));
}

function limitText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

function toJsonObject(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}

function normalizeToken(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function normalizeExtension(value: string): string | undefined {
  const token = normalizeToken(value);
  return token ? (token.startsWith(".") ? token : `.${token}`) : undefined;
}
