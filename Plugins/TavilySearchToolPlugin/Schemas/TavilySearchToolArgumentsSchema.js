"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var TavilySearchToolArgumentsSchema_exports = {};
__export(TavilySearchToolArgumentsSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(TavilySearchToolArgumentsSchema_exports);
var import_zod = require("@senera/tool-plugin-sdk");
const DateSchema = import_zod.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "\u65E5\u671F\u683C\u5F0F\u5FC5\u987B\u662F YYYY-MM-DD\u3002");
const BooleanLikeSchema = import_zod.z.preprocess(
  coerceBooleanLike,
  import_zod.z.boolean()
);
const IncludeAnswerSchema = import_zod.z.preprocess(
  coerceBooleanSelectLike(["basic", "advanced"]),
  import_zod.z.union([
    import_zod.z.boolean(),
    import_zod.z.enum(["basic", "advanced"])
  ])
);
const IncludeRawContentSchema = import_zod.z.preprocess(
  coerceBooleanSelectLike(["markdown", "text"]),
  import_zod.z.union([
    import_zod.z.boolean(),
    import_zod.z.enum(["markdown", "text"])
  ])
);
const StringArrayObjectSchema = import_zod.z.object({
  item: import_zod.z.array(import_zod.z.string().min(1)).default([])
}).strict();
const Schema = import_zod.z.object({
  query: import_zod.z.string().trim().min(1),
  searchDepth: import_zod.z.enum(["basic", "advanced", "fast", "ultra-fast"]).default("basic"),
  topic: import_zod.z.enum(["general", "news", "finance"]).default("general"),
  maxResults: import_zod.z.coerce.number().int().min(1).max(20).default(5),
  includeAnswer: IncludeAnswerSchema.default(false),
  includeRawContent: IncludeRawContentSchema.default(false),
  includeImages: BooleanLikeSchema.default(false),
  includeImageDescriptions: BooleanLikeSchema.default(false),
  includeFavicon: BooleanLikeSchema.default(false),
  includeDomains: StringArrayObjectSchema.optional(),
  excludeDomains: StringArrayObjectSchema.optional(),
  timeRange: import_zod.z.enum(["day", "week", "month", "year", "d", "w", "m", "y"]).optional(),
  days: import_zod.z.coerce.number().int().min(1).optional(),
  startDate: DateSchema.optional(),
  endDate: DateSchema.optional(),
  chunksPerSource: import_zod.z.coerce.number().int().min(1).max(3).optional(),
  country: import_zod.z.string().trim().min(1).optional(),
  autoParameters: BooleanLikeSchema.default(false),
  exactMatch: BooleanLikeSchema.default(false),
  includeUsage: BooleanLikeSchema.default(true),
  safeSearch: BooleanLikeSchema.default(false),
  timeoutMs: import_zod.z.coerce.number().int().min(1e3).max(3e5).optional()
}).strict().refine(
  (value) => value.searchDepth === "advanced" || value.chunksPerSource === void 0,
  {
    message: "chunksPerSource \u53EA\u80FD\u548C searchDepth=advanced \u4E00\u8D77\u4F7F\u7528\u3002",
    path: ["chunksPerSource"]
  }
).refine(
  (value) => !(value.safeSearch && (value.searchDepth === "fast" || value.searchDepth === "ultra-fast")),
  {
    message: "safeSearch \u4E0D\u652F\u6301 searchDepth=fast \u6216 ultra-fast\u3002",
    path: ["safeSearch"]
  }
);
function coerceBooleanLike(value) {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return value;
}
function coerceBooleanSelectLike(selectValues) {
  const allowed = new Set(selectValues);
  return (value) => {
    const coerced = coerceBooleanLike(value);
    if (typeof coerced !== "string") {
      return coerced;
    }
    const normalized = coerced.trim().toLowerCase();
    return allowed.has(normalized) ? normalized : coerced;
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Schema
});
