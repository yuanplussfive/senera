import { OfficeParser, type OfficeChunk, type SupportedFileType } from "officeparser";
import { z } from "zod";
import type {
  AgentDocumentExtractOptions,
  AgentDocumentExtractChunk,
  AgentDocumentExtractWarning,
} from "./AgentDocumentExtractTypes.js";
import type { AgentDocumentProbeResult } from "./AgentDocumentProbeTypes.js";
import type { AgentDocumentExtractorConfig, AgentDocumentExtractorHandler } from "./AgentDocumentExtractorTypes.js";
import {
  collectProbeExtensions,
  collectProbeMimes,
  normalizeExtension,
  normalizeToken,
} from "./AgentDocumentExtractorMatching.js";
import { limitText, toJsonObject } from "./AgentDocumentExtractUtils.js";

type OfficeIssueLike = {
  type: "warning" | "info" | "error";
  code: unknown;
  message: string;
};

interface AgentDocumentFileTypeSelectors {
  mimes?: string[];
  extensions?: string[];
}

interface OfficeSelectionData {
  fileType: SupportedFileType;
}

const FileTypeSelectorSchema = z
  .object({
    mimes: z.array(z.string().trim().min(1)).optional(),
    extensions: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const OfficeExtractorConfigSchema = z
  .object({
    fileTypes: z.record(z.string().trim().min(1), FileTypeSelectorSchema).optional(),
  })
  .passthrough();

type AgentDocumentOfficeExtractorConfig = z.infer<typeof OfficeExtractorConfigSchema>;

export const AgentDocumentOfficeExtractor: AgentDocumentExtractorHandler<OfficeSelectionData> = {
  type: "officeparser",
  select(input) {
    const config = readOfficeExtractorConfig(input.config);
    const fileType = selectOfficeParserFileType(input.probe, config.fileTypes ?? {});
    return fileType
      ? {
          name: input.name,
          config: input.config,
          data: {
            fileType,
          },
        }
      : undefined;
  },
  async extract({ input, options, probe, selection }) {
    const config = readOfficeExtractorConfig(selection.config);
    const fileType = selection.data?.fileType ?? selectOfficeParserFileType(probe, config.fileTypes ?? {});
    if (!fileType) {
      throw new Error("配置的 officeparser 抽取器无法处理当前文档。");
    }

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
    const chunks = Array.isArray(chunkResult?.value) ? projectOfficeChunks(chunkResult.value, options) : [];

    return {
      status: "extracted",
      parser: selection.config.type,
      fileType: ast.type,
      textPreview: limitText(text, options.output.maxTextChars),
      markdownPreview: limitText(markdown, options.output.maxMarkdownChars),
      textLength: text.length,
      markdownLength: markdown.length,
      metadata: toJsonObject(ast.metadata),
      structure: {
        topLevelNodeCount: ast.content.length,
        attachmentCount: ast.attachments.length,
        warningCount: [...warnings, ...ast.warnings, ...markdownResult.messages, ...(chunkResult?.messages ?? [])]
          .length,
      },
      chunks,
      warnings: projectWarnings([
        ...warnings,
        ...ast.warnings,
        ...markdownResult.messages,
        ...(chunkResult?.messages ?? []),
      ]),
    };
  },
};

function readOfficeExtractorConfig(config: AgentDocumentExtractorConfig): AgentDocumentOfficeExtractorConfig {
  return OfficeExtractorConfigSchema.parse(config);
}

function selectOfficeParserFileType(
  probe: AgentDocumentProbeResult,
  fileTypes: Record<string, AgentDocumentFileTypeSelectors>,
): SupportedFileType | undefined {
  const mimes = collectProbeMimes(probe);
  const extensions = collectProbeExtensions(probe);

  for (const [fileType, selectors] of Object.entries(fileTypes)) {
    if (selectors.mimes?.some((mime) => mimes.has(normalizeToken(mime) ?? ""))) {
      return fileType as SupportedFileType;
    }
    if (selectors.extensions?.some((extension) => extensions.has(normalizeExtension(extension) ?? ""))) {
      return fileType as SupportedFileType;
    }
  }

  return undefined;
}

function projectOfficeChunks(chunks: OfficeChunk[], options: AgentDocumentExtractOptions): AgentDocumentExtractChunk[] {
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
