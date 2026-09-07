import { z } from "zod";

const Extractor = z
  .object({ type: z.string().trim().min(1), enabled: z.boolean(), priority: z.number().finite() })
  .catchall(z.unknown());

export const AgentDocumentToolConfigurationSchema = z
  .object({
    extractors: z.record(z.string().trim().min(1), Extractor),
    probe: z
      .object({
        sampleBytes: z.number().int().positive(),
        containerMaxEntries: z.number().int().positive(),
        containerMaxEntryBytes: z.number().int().positive(),
        contentTypesEntryName: z.string().trim().min(1),
      })
      .strict(),
    parse: z
      .object({
        ocr: z.boolean(),
        extractAttachments: z.boolean(),
        includeRawContent: z.boolean(),
        ignoreNotes: z.boolean(),
        ignoreComments: z.boolean(),
        ignoreHeadersAndFooters: z.boolean(),
        ignoreSlideMasters: z.boolean(),
        ignoreInternalLinks: z.boolean(),
        newlineDelimiter: z.string(),
      })
      .strict(),
    output: z
      .object({
        maxFileBytes: z.number().int().positive(),
        maxTextChars: z.number().int().nonnegative(),
        maxMarkdownChars: z.number().int().nonnegative(),
        maxChunks: z.number().int().nonnegative(),
        maxChunkChars: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type AgentDocumentToolConfiguration = z.output<typeof AgentDocumentToolConfigurationSchema>;

export const DefaultAgentDocumentToolConfiguration = AgentDocumentToolConfigurationSchema.parse({
  probe: {
    sampleBytes: 65_536,
    containerMaxEntries: 80,
    containerMaxEntryBytes: 262_144,
    contentTypesEntryName: "[Content_Types].xml",
  },
  parse: {
    ocr: false,
    extractAttachments: false,
    includeRawContent: false,
    ignoreNotes: false,
    ignoreComments: false,
    ignoreHeadersAndFooters: false,
    ignoreSlideMasters: true,
    ignoreInternalLinks: true,
    newlineDelimiter: "\n",
  },
  output: {
    maxFileBytes: 52_428_800,
    maxTextChars: 12_000,
    maxMarkdownChars: 16_000,
    maxChunks: 24,
    maxChunkChars: 1_600,
  },
  extractors: {
    officeparser: {
      type: "officeparser",
      enabled: true,
      priority: 100,
      fileTypes: {
        docx: {
          mimes: [
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-word.document.macroenabled.12",
          ],
          extensions: [".docx", ".docm"],
        },
        pptx: {
          mimes: [
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.ms-powerpoint.presentation.macroenabled.12",
          ],
          extensions: [".pptx", ".pptm"],
        },
        xlsx: {
          mimes: [
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel.sheet.macroenabled.12",
          ],
          extensions: [".xlsx", ".xlsm"],
        },
        pdf: { mimes: ["application/pdf"], extensions: [".pdf"] },
        odt: { mimes: ["application/vnd.oasis.opendocument.text"], extensions: [".odt"] },
        odp: { mimes: ["application/vnd.oasis.opendocument.presentation"], extensions: [".odp"] },
        ods: { mimes: ["application/vnd.oasis.opendocument.spreadsheet"], extensions: [".ods"] },
        rtf: { mimes: ["application/rtf", "text/rtf"], extensions: [".rtf"] },
        csv: { mimes: ["text/csv"], extensions: [".csv"] },
        md: { mimes: ["text/markdown", "text/x-markdown"], extensions: [".md", ".markdown"] },
        html: { mimes: ["text/html"], extensions: [".html", ".htm"] },
      },
    },
    text: {
      type: "text",
      enabled: true,
      priority: 10,
      match: { mediaTypes: ["text"], isText: true },
      decode: { defaultEncoding: "utf8" },
    },
  },
});
