"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var import_zod = require("@senera/tool-plugin-sdk");
var import_plugin_sdk = require("@senera/tool-plugin-sdk");
var import_TavilySearchToolArgumentsSchema = require("./Schemas/TavilySearchToolArgumentsSchema.js");
var import_TavilySearchToolResultSchema = require("./Schemas/TavilySearchToolResultSchema.js");
const ConfigFileName = "PluginConfig.toml";
const DefaultBaseUrl = "https://api.tavily.com";
const DefaultTimeoutMs = 3e5;
const DefaultStateDir = ".state";
const ConfigSchema = import_zod.z.object({
  senera: import_zod.z.unknown().optional(),
  tavily: import_zod.z.object({
    api_keys: import_zod.z.array(import_zod.z.string().trim().min(1)).min(1),
    base_url: import_zod.z.string().trim().url().default(DefaultBaseUrl),
    timeout_ms: import_zod.z.coerce.number().int().min(1e3).max(3e5).default(DefaultTimeoutMs),
    state_dir: import_zod.z.string().trim().min(1).default(DefaultStateDir)
  }).strict()
}).strict();
void (0, import_plugin_sdk.runToolPlugin)({
  toolName: "TavilySearchTool",
  argumentSchema: import_TavilySearchToolArgumentsSchema.Schema,
  resultSchema: import_TavilySearchToolResultSchema.Schema,
  async execute(args) {
    const config = readConfig();
    const apiKey = await claimNextApiKey(config);
    const response = await searchTavily({
      args,
      config,
      apiKey
    });
    return {
      query: response.query ?? args.query,
      answer: normalizeOptionalString(response.answer),
      results: {
        item: normalizeResults(response.results)
      },
      images: {
        item: normalizeImages(response.images)
      },
      responseTime: normalizeNumber(response.response_time),
      requestId: normalizeOptionalString(response.request_id),
      usage: response.usage ? {
        credits: normalizeNumber(response.usage.credits)
      } : void 0,
      autoParameters: response.auto_parameters ? {
        topic: normalizeOptionalString(response.auto_parameters.topic),
        searchDepth: normalizeOptionalString(response.auto_parameters.search_depth)
      } : void 0,
      source: "Tavily"
    };
  }
});
function readConfig() {
  const parsed = (0, import_plugin_sdk.readPluginTomlConfig)(ConfigFileName, {
    exampleFileName: "PluginConfig.example.toml"
  });
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Tavily 插件配置无效：${import_node_path.default.resolve(process.cwd(), ConfigFileName)}：${result.error.message}`);
  }
  return result.data.tavily;
}
async function claimNextApiKey(config) {
  const keys = config.api_keys;
  if (keys.length === 1) {
    return keys[0];
  }
  const stateFilePath = resolveStateFilePath(config);
  import_node_fs.default.mkdirSync(import_node_path.default.dirname(stateFilePath), { recursive: true });
  const releaseLock = await acquireStateLock(`${stateFilePath}.lock`);
  try {
    const current = readKeyCursor(stateFilePath);
    const nextIndex = current % keys.length;
    const nextCursor = (nextIndex + 1) % keys.length;
    writeJsonFileAtomic(stateFilePath, {
      cursor: nextCursor,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return keys[nextIndex];
  } finally {
    releaseLock();
  }
}
function resolveStateFilePath(config) {
  const stateDir = import_node_path.default.isAbsolute(config.state_dir) ? config.state_dir : import_node_path.default.resolve(process.cwd(), config.state_dir);
  return import_node_path.default.join(stateDir, "tavily-key-cursor.json");
}
function readKeyCursor(stateFilePath) {
  try {
    const raw = import_node_fs.default.readFileSync(stateFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed.cursor === "number" && Number.isInteger(parsed.cursor) && parsed.cursor >= 0 ? parsed.cursor : 0;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return 0;
    }
    return 0;
  }
}
async function acquireStateLock(lockFilePath) {
  const startedAt = Date.now();
  const timeoutMs = 3e3;
  const staleMs = 1e4;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const handle = await import_node_fs.default.promises.open(lockFilePath, "wx");
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      }));
      await handle.close();
      return () => {
        import_node_fs.default.rmSync(lockFilePath, { force: true });
      };
    } catch (error) {
      if (!isNodeErrorCode(error, "EEXIST")) {
        throw error;
      }
      removeStaleLock(lockFilePath, staleMs);
      await sleep(50);
    }
  }
  throw new Error(`Tavily key \u8F6E\u8BE2\u72B6\u6001\u9501\u7B49\u5F85\u8D85\u65F6\uFF1A${lockFilePath}`);
}
function removeStaleLock(lockFilePath, staleMs) {
  try {
    const stat = import_node_fs.default.statSync(lockFilePath);
    if (Date.now() - stat.mtimeMs > staleMs) {
      import_node_fs.default.rmSync(lockFilePath, { force: true });
    }
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}
function writeJsonFileAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  import_node_fs.default.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  import_node_fs.default.renameSync(tempPath, filePath);
}
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function isNodeErrorCode(error, code) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  return error.code === code;
}
async function searchTavily(options) {
  const controller = new AbortController();
  const timeoutMs = options.args.timeoutMs ?? options.config.timeout_ms;
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(new URL("/search", options.config.base_url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(toTavilyPayload(options.args)),
      signal: controller.signal
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(formatTavilyError(response.status, response.statusText, responseText));
    }
    return responseText.length > 0 ? JSON.parse(responseText) : {};
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Tavily \u641C\u7D22\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8D85\u8FC7 ${timeoutMs}ms\u3002`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function toTavilyPayload(args) {
  return omitUndefined({
    query: args.query,
    search_depth: args.searchDepth,
    topic: args.topic,
    max_results: args.maxResults,
    include_answer: args.includeAnswer,
    include_raw_content: args.includeRawContent,
    include_images: args.includeImages,
    include_image_descriptions: args.includeImageDescriptions,
    include_favicon: args.includeFavicon,
    include_domains: args.includeDomains?.item,
    exclude_domains: args.excludeDomains?.item,
    time_range: args.timeRange,
    days: args.days,
    start_date: args.startDate,
    end_date: args.endDate,
    chunks_per_source: args.chunksPerSource,
    country: args.country,
    auto_parameters: args.autoParameters,
    exact_match: args.exactMatch,
    include_usage: args.includeUsage,
    safe_search: args.safeSearch
  });
}
function normalizeResults(results) {
  return Array.isArray(results)
    ? results.filter(isRecord).map(normalizeResult)
    : [];
}
function normalizeResult(result) {
  return {
    title: normalizeString(result.title),
    url: normalizeString(result.url),
    content: normalizeString(result.content),
    score: normalizeNumber(result.score),
    publishedDate: normalizeOptionalString(result.published_date),
    rawContent: normalizeOptionalString(result.raw_content),
    favicon: normalizeOptionalString(result.favicon),
    images: result.images ? {
      item: normalizeImages(result.images)
    } : void 0
  };
}
function normalizeString(value) {
  return typeof value === "string" ? value : "";
}
function normalizeOptionalString(value) {
  return typeof value === "string" ? value : void 0;
}
function normalizeNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : void 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function normalizeImages(images) {
  return (Array.isArray(images) ? images : []).filter((image) =>
    typeof image === "string" || isRecord(image)
  ).map((image) => typeof image === "string" ? { url: image } : {
    url: normalizeString(image.url),
    description: normalizeOptionalString(image.description)
  }).filter((image) => image.url.length > 0);
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function omitUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== void 0)
  );
}
function formatTavilyError(status, statusText, responseText) {
  if (!responseText.trim()) {
    return `Tavily \u641C\u7D22\u8BF7\u6C42\u5931\u8D25\uFF1A${status} ${statusText}`;
  }
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return `Tavily \u641C\u7D22\u8BF7\u6C42\u5931\u8D25\uFF1A${status} ${statusText}\uFF1A${responseText.slice(0, 500)}`;
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed;
    const detail = record.detail ?? record.error ?? record.message;
    if (detail) {
      return `Tavily \u641C\u7D22\u8BF7\u6C42\u5931\u8D25\uFF1A${status} ${statusText}\uFF1A${JSON.stringify(detail)}`;
    }
  }
  return `Tavily \u641C\u7D22\u8BF7\u6C42\u5931\u8D25\uFF1A${status} ${statusText}\uFF1A${JSON.stringify(parsed).slice(0, 500)}`;
}
