import fs from "node:fs/promises";
import iconv from "iconv-lite";
import { z } from "zod";
import type { AgentDocumentExtractChunk, AgentDocumentExtractOptions } from "./AgentDocumentExtractTypes.js";
import type { AgentDocumentProbeResult } from "./AgentDocumentProbeTypes.js";
import type { AgentDocumentExtractorConfig, AgentDocumentExtractorHandler } from "./AgentDocumentExtractorTypes.js";
import { matchesProbeSelector, normalizeToken } from "./AgentDocumentExtractorMatching.js";
import { countLines, limitText } from "./AgentDocumentExtractUtils.js";

interface AgentDocumentTextDecodeOptions {
  defaultEncoding: string;
}

const ExtractorMatcherSchema = z
  .object({
    mimes: z.array(z.string().trim().min(1)).optional(),
    mimePrefixes: z.array(z.string().trim().min(1)).optional(),
    extensions: z.array(z.string().trim().min(1)).optional(),
    mediaTypes: z.array(z.string().trim().min(1)).optional(),
    isText: z.boolean().optional(),
    isBinary: z.boolean().optional(),
    containerFormats: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const TextDecodeSchema = z
  .object({
    defaultEncoding: z.string().trim().min(1),
  })
  .strict();

const TextExtractorConfigSchema = z
  .object({
    match: ExtractorMatcherSchema.optional(),
    decode: TextDecodeSchema.optional(),
  })
  .passthrough();

type AgentDocumentTextExtractorConfig = z.infer<typeof TextExtractorConfigSchema>;

export const AgentDocumentTextExtractor: AgentDocumentExtractorHandler = {
  type: "text",
  select(input) {
    const config = readTextExtractorConfig(input.config);
    return matchesProbeSelector(input.probe, config.match)
      ? {
          name: input.name,
          config: input.config,
        }
      : undefined;
  },
  async extract({ input, options, probe, selection }) {
    const buffer = await fs.readFile(input.filePath);
    const config = readTextExtractorConfig(selection.config);
    const encoding = resolveTextEncoding(probe, config.decode);
    const text = iconv.decode(buffer, encoding, {
      stripBOM: true,
    });
    const chunks = projectTextChunks(text, options);

    return {
      status: "extracted",
      parser: selection.config.type,
      fileType: selection.name,
      textPreview: limitText(text, options.output.maxTextChars),
      markdownPreview: limitText(text, options.output.maxMarkdownChars),
      textLength: text.length,
      markdownLength: text.length,
      metadata: {
        encoding,
        bytes: buffer.byteLength,
        lineCount: countLines(text),
      },
      structure: {
        topLevelNodeCount: chunks.length,
        attachmentCount: 0,
        warningCount: 0,
      },
      chunks,
      warnings: [],
    };
  },
};

function readTextExtractorConfig(config: AgentDocumentExtractorConfig): AgentDocumentTextExtractorConfig {
  return TextExtractorConfigSchema.parse(config);
}

function resolveTextEncoding(
  probe: AgentDocumentProbeResult,
  options: AgentDocumentTextDecodeOptions | undefined,
): string {
  const candidates = [probe.charset, options?.defaultEncoding];

  for (const candidate of candidates) {
    const encoding = normalizeToken(candidate);
    if (encoding && iconv.encodingExists(encoding)) {
      return encoding;
    }
  }

  throw new Error("文本抽取器没有可用编码配置。");
}

function projectTextChunks(text: string, options: AgentDocumentExtractOptions): AgentDocumentExtractChunk[] {
  if (options.output.maxChunks <= 0 || options.output.maxChunkChars <= 0 || text.length === 0) {
    return [];
  }

  const chunks: AgentDocumentExtractChunk[] = [];
  for (
    let offset = 0;
    offset < text.length && chunks.length < options.output.maxChunks;
    offset += options.output.maxChunkChars
  ) {
    const value = text.slice(offset, offset + options.output.maxChunkChars);
    chunks.push({
      index: chunks.length,
      text: value,
      length: value.length,
      metadata: {
        offset,
      },
    });
  }
  return chunks;
}
