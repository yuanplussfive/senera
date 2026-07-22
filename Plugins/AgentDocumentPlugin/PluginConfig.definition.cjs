"use strict";

const { definePluginConfiguration, z } = require("@senera/tool-plugin-sdk");

const ExtractorSchema = z
  .object({
    type: z.string().trim().min(1),
    enabled: z.boolean(),
    priority: z.number().finite(),
  })
  .catchall(z.unknown());

const configuration = definePluginConfiguration({
  schema: z
    .object({
      senera: z.object({ enabled: z.boolean() }).passthrough(),
      document: z
        .object({
          defaultMode: z.string().trim().min(1),
          modes: z.array(z.string().trim().min(1)).min(1),
        })
        .strict(),
      extractors: z.record(z.string().trim().min(1), ExtractorSchema).refine((value) => Object.keys(value).length > 0),
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
    .strict(),
  defaults: {
    senera: { enabled: true },
    document: { defaultMode: "auto", modes: ["auto", "probe", "extract"] },
    probe: {
      sampleBytes: 65536,
      containerMaxEntries: 80,
      containerMaxEntryBytes: 262144,
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
      maxFileBytes: 52428800,
      maxTextChars: 12000,
      maxMarkdownChars: 16000,
      maxChunks: 24,
      maxChunkChars: 1600,
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
  },
  form: {
    allowedPaths: [{ path: ["extractors"], recursive: true }],
    sections: [
      {
        id: "senera",
        label: "启用状态",
        fields: [{ path: ["senera", "enabled"], label: "启用插件", type: "boolean" }],
      },
      {
        id: "document",
        label: "文档模式",
        fields: [
          {
            path: ["document", "defaultMode"],
            label: "默认处理模式",
            type: "string",
            options: ["auto", "probe", "extract"],
          },
          { path: ["document", "modes"], label: "允许模式", type: "array", itemType: "string" },
        ],
      },
      {
        id: "probe",
        label: "文件探测",
        fields: [
          { path: ["probe", "sampleBytes"], label: "采样字节数", type: "number", min: 1, step: 1024 },
          { path: ["probe", "containerMaxEntries"], label: "容器入口数", type: "number", min: 1, step: 1 },
          { path: ["probe", "containerMaxEntryBytes"], label: "容器入口字节数", type: "number", min: 1, step: 1024 },
          { path: ["probe", "contentTypesEntryName"], label: "内容类型入口", type: "string" },
        ],
      },
      {
        id: "parse",
        label: "解析选项",
        fields: [
          { path: ["parse", "ocr"], label: "启用 OCR", type: "boolean" },
          { path: ["parse", "extractAttachments"], label: "抽取附件", type: "boolean" },
          { path: ["parse", "includeRawContent"], label: "保留原始内容", type: "boolean" },
          { path: ["parse", "ignoreNotes"], label: "忽略备注", type: "boolean" },
          { path: ["parse", "ignoreComments"], label: "忽略批注", type: "boolean" },
          { path: ["parse", "ignoreHeadersAndFooters"], label: "忽略页眉页脚", type: "boolean" },
          { path: ["parse", "ignoreSlideMasters"], label: "忽略母版", type: "boolean" },
          { path: ["parse", "ignoreInternalLinks"], label: "忽略内部链接", type: "boolean" },
          { path: ["parse", "newlineDelimiter"], label: "换行分隔符", type: "string" },
        ],
      },
      {
        id: "output",
        label: "输出限制",
        fields: [
          { path: ["output", "maxFileBytes"], label: "最大文件字节数", type: "number", min: 1, step: 1024 },
          { path: ["output", "maxTextChars"], label: "文本预览字符数", type: "number", min: 0, step: 100 },
          { path: ["output", "maxMarkdownChars"], label: "Markdown 预览字符数", type: "number", min: 0, step: 100 },
          { path: ["output", "maxChunks"], label: "Chunk 数量", type: "number", min: 0, step: 1 },
          { path: ["output", "maxChunkChars"], label: "Chunk 字符数", type: "number", min: 0, step: 100 },
        ],
      },
      {
        id: "extractors",
        label: "抽取器",
        description: "抽取器是可扩展的具名表；保留默认映射或按插件文档调整。",
        fields: [{ path: ["extractors"], label: "抽取器配置", type: "table" }],
      },
    ],
  },
});

module.exports = { configuration };
