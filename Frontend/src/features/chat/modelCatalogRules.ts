import type { ModelCapabilitiesDraft } from "./modelConfigTypes";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";

export type ModelCatalogMatchKind = "prefix" | "includes" | "exact";

export interface ModelCatalogGroup {
  id: string;
  label: string;
  icon?: string;
}

interface ModelCatalogRule {
  id: string;
  label?: string;
  icon?: string;
  match: ModelCatalogMatchKind;
  values: readonly string[];
  capabilities?: Partial<ModelCapabilitiesDraft>;
  labelKey?: FrontendMessageKey;
}

interface ProviderCatalogRule {
  id: string;
  label?: string;
  labelKey?: FrontendMessageKey;
  icon: string;
  aliases: readonly string[];
}

/**
 * A deliberately local catalogue. Provider names are used as hints, while
 * model-family rules win when a model name is more specific (for example,
 * `gpt-4o` stays OpenAI even when it is served through an Azure endpoint).
 */
const MODEL_CATALOG: readonly ModelCatalogRule[] = [
  {
    id: "xai",
    label: "xAI",
    icon: "grok",
    match: "prefix",
    values: ["grok-", "grok"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "openai",
    label: "OpenAI",
    icon: "openai",
    match: "prefix",
    values: ["gpt-", "o1", "o3", "o4", "text-embedding-", "dall-e", "gpt-image"],
    capabilities: { Chat: true },
  },
  {
    id: "anthropic",
    label: "Claude",
    icon: "anthropic",
    match: "prefix",
    values: ["claude-"],
    capabilities: { Chat: true, Vision: true, ToolCalling: true },
  },
  {
    id: "gemini",
    label: "Gemini",
    icon: "gemini",
    match: "prefix",
    values: ["gemini"],
    capabilities: { Chat: true, Vision: true, ToolCalling: true },
  },
  {
    id: "gemma",
    label: "Gemma",
    icon: "gemma",
    match: "prefix",
    values: ["gemma-"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    icon: "deepseek",
    match: "prefix",
    values: ["deepseek"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "qwen",
    label: "Qwen",
    icon: "qwen",
    match: "prefix",
    values: ["qwen", "qwq"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "mistral",
    label: "Mistral",
    icon: "mistral",
    match: "prefix",
    values: ["mistral", "mixtral", "codestral", "devstral", "pixtral", "ministral"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "llama",
    label: "Llama",
    icon: "meta",
    match: "includes",
    values: ["llama"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi",
    icon: "moonshot",
    match: "includes",
    values: ["moonshot", "kimi"],
    capabilities: { Chat: true, Vision: true, ToolCalling: true },
  },
  {
    id: "zhipu",
    labelKey: "model.catalog.zhipu",
    icon: "zhipu",
    match: "includes",
    values: ["glm-", "chatglm", "zhipu"],
    capabilities: { Chat: true, Vision: true, ToolCalling: true },
  },
  {
    id: "minimax",
    label: "MiniMax",
    icon: "minimax",
    match: "prefix",
    values: ["minimax"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "doubao",
    labelKey: "model.catalog.doubao",
    icon: "doubao",
    match: "includes",
    values: ["doubao", "seed-"],
    capabilities: { Chat: true, Vision: true, ToolCalling: true },
  },
  {
    id: "baichuan",
    label: "Baichuan",
    icon: "baichuan",
    match: "prefix",
    values: ["baichuan"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "hunyuan",
    labelKey: "model.catalog.hunyuan",
    icon: "hunyuan",
    match: "prefix",
    values: ["hunyuan", "hunyuan-"],
    capabilities: { Chat: true, Vision: true, ToolCalling: true },
  },
  {
    id: "internlm",
    label: "InternLM",
    icon: "internlm",
    match: "prefix",
    values: ["internlm"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "yi",
    label: "Yi",
    icon: "yi",
    match: "prefix",
    values: ["yi-", "yi"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "cohere",
    label: "Cohere",
    icon: "cohere",
    match: "prefix",
    values: ["command", "cohere"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "ai21",
    label: "AI21 / Jamba",
    icon: "ai21",
    match: "prefix",
    values: ["jamba-", "jamba"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "amazon-nova",
    label: "Amazon Nova",
    icon: "nova",
    match: "prefix",
    values: ["nova-"],
    capabilities: { Chat: true, Vision: true, ToolCalling: true },
  },
  {
    id: "llava",
    label: "LLaVA",
    icon: "llava",
    match: "prefix",
    values: ["llava"],
    capabilities: { Chat: true, Vision: true },
  },
  {
    id: "microsoft",
    label: "Microsoft",
    icon: "microsoft",
    match: "prefix",
    values: ["phi-", "phi"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "rwkv",
    label: "RWKV",
    icon: "rwkv",
    match: "prefix",
    values: ["rwkv"],
    capabilities: { Chat: true },
  },
  {
    id: "voyage",
    label: "Voyage AI",
    icon: "voyage",
    match: "prefix",
    values: ["voyage-"],
    capabilities: { Embedding: true, Chat: false },
  },
  {
    id: "yuanbao",
    labelKey: "model.catalog.yuanbao",
    icon: "yuanbao",
    match: "prefix",
    values: ["yuanbao"],
    capabilities: { Chat: true, Vision: true, ToolCalling: true },
  },
  {
    id: "jina",
    label: "Jina AI",
    icon: "jina",
    match: "prefix",
    values: ["jina-"],
  },
  {
    id: "baai",
    label: "BAAI",
    icon: "baai",
    match: "prefix",
    values: ["bge-", "bge_"],
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    icon: "nvidia",
    match: "prefix",
    values: ["nvidia/", "nvidia-"],
  },
  {
    id: "ollama",
    label: "Ollama",
    icon: "ollama",
    match: "prefix",
    values: ["ollama/"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    icon: "openrouter",
    match: "prefix",
    values: ["openrouter/"],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    icon: "perplexity",
    match: "prefix",
    values: ["sonar-", "perplexity/"],
    capabilities: { Chat: true, ToolCalling: true },
  },
  {
    id: "groq",
    label: "Groq",
    icon: "groq",
    match: "prefix",
    values: ["groq/"],
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    icon: "fireworks",
    match: "prefix",
    values: ["accounts/", "fireworks/"],
  },
  {
    id: "embedding",
    labelKey: "model.catalog.embedding",
    icon: "baai",
    match: "includes",
    values: ["embedding", "embed-", "e5-", "gte-", "mxbai", "nomic-embed", "text2vec", "voyage-"],
    capabilities: { Embedding: true, Chat: false },
  },
  {
    id: "rerank",
    labelKey: "model.catalog.rerank",
    icon: "cohere",
    match: "includes",
    values: ["rerank", "re-rank", "ranker", "cross-encoder"],
    capabilities: { Rerank: true, Chat: false },
  },
  {
    id: "vision",
    labelKey: "model.catalog.multimodal",
    icon: "gemini",
    match: "includes",
    values: ["vision", "-vl", "_vl", "llava", "internvl", "minicpm-v", "pixtral", "omni"],
    capabilities: { Vision: true, Chat: true },
  },
  {
    id: "image-generation",
    labelKey: "model.catalog.imageGeneration",
    icon: "google",
    match: "includes",
    values: ["dall-e", "gpt-image", "imagen", "flux", "stable-diffusion", "sdxl", "cogview", "ideogram"],
    capabilities: { ImageOutput: true },
  },
];

const PROVIDER_CATALOG: readonly ProviderCatalogRule[] = [
  { id: "openai", label: "OpenAI", icon: "openai", aliases: ["openai", "open-ai"] },
  { id: "anthropic", label: "Anthropic", icon: "anthropic", aliases: ["anthropic", "claude"] },
  { id: "google", label: "Google", icon: "google", aliases: ["google", "gemini", "vertex", "vertexai"] },
  { id: "azure", label: "Azure", icon: "azure", aliases: ["azure", "azureai", "azure-openai"] },
  { id: "deepseek", label: "DeepSeek", icon: "deepseek", aliases: ["deepseek"] },
  { id: "qwen", label: "Qwen", icon: "qwen", aliases: ["qwen", "alibaba", "dashscope", "bailian"] },
  { id: "mistral", label: "Mistral", icon: "mistral", aliases: ["mistral"] },
  { id: "meta", label: "Meta", icon: "meta", aliases: ["meta", "llama"] },
  { id: "xai", label: "xAI", icon: "xai", aliases: ["xai", "grok"] },
  { id: "moonshot", label: "Moonshot / Kimi", icon: "moonshot", aliases: ["moonshot", "kimi"] },
  { id: "zhipu", labelKey: "model.catalog.zhipuShort", icon: "zhipu", aliases: ["zhipu", "chatglm", "glm"] },
  { id: "minimax", label: "MiniMax", icon: "minimax", aliases: ["minimax"] },
  { id: "doubao", labelKey: "model.catalog.doubao", icon: "doubao", aliases: ["doubao", "volc"] },
  { id: "volcengine", labelKey: "model.catalog.volcengine", icon: "volcengine", aliases: ["volcengine"] },
  { id: "baichuan", label: "Baichuan", icon: "baichuan", aliases: ["baichuan"] },
  { id: "cohere", label: "Cohere", icon: "cohere", aliases: ["cohere"] },
  { id: "ai21", label: "AI21", icon: "ai21", aliases: ["ai21", "jamba"] },
  { id: "amazon", label: "Amazon", icon: "bedrock", aliases: ["amazon", "aws", "bedrock"] },
  { id: "huggingface", label: "Hugging Face", icon: "huggingface", aliases: ["huggingface", "hf"] },
  { id: "ollama", label: "Ollama", icon: "ollama", aliases: ["ollama"] },
  { id: "openrouter", label: "OpenRouter", icon: "openrouter", aliases: ["openrouter"] },
  { id: "perplexity", label: "Perplexity", icon: "perplexity", aliases: ["perplexity"] },
  { id: "groq", label: "Groq", icon: "groq", aliases: ["groq"] },
  { id: "cloudflare", label: "Cloudflare", icon: "cloudflare", aliases: ["cloudflare", "workers-ai"] },
  { id: "bedrock", label: "Amazon Bedrock", icon: "bedrock", aliases: ["bedrock", "aws"] },
  { id: "fireworks", label: "Fireworks AI", icon: "fireworks", aliases: ["fireworks", "fireworksai"] },
  { id: "together", label: "Together AI", icon: "together", aliases: ["together", "togetherai"] },
  { id: "cerebras", label: "Cerebras", icon: "cerebras", aliases: ["cerebras"] },
  { id: "nvidia", label: "NVIDIA", icon: "nvidia", aliases: ["nvidia", "nim"] },
  { id: "lmstudio", label: "LM Studio", icon: "lmstudio", aliases: ["lmstudio", "lm-studio"] },
  { id: "vllm", label: "vLLM", icon: "vllm", aliases: ["vllm"] },
  { id: "modelscope", label: "ModelScope", icon: "modelscope", aliases: ["modelscope", "model-scope"] },
  {
    id: "siliconcloud",
    labelKey: "model.catalog.siliconcloud",
    icon: "siliconcloud",
    aliases: ["siliconcloud", "siliconflow"],
  },
  { id: "ppio", label: "PPIO", icon: "ppio", aliases: ["ppio"] },
  { id: "jina", label: "Jina AI", icon: "jina", aliases: ["jina"] },
  { id: "voyage", label: "Voyage AI", icon: "voyage", aliases: ["voyage"] },
  { id: "internlm", label: "InternLM", icon: "internlm", aliases: ["internlm"] },
  { id: "hunyuan", labelKey: "model.catalog.hunyuan", icon: "hunyuan", aliases: ["hunyuan", "tencent"] },
  { id: "sensenova", labelKey: "model.catalog.sensenova", icon: "sensenova", aliases: ["sensenova", "sensecore"] },
  { id: "stepfun", labelKey: "model.catalog.stepfun", icon: "stepfun", aliases: ["stepfun"] },
  { id: "spark", labelKey: "model.catalog.spark", icon: "spark", aliases: ["spark", "iflytek"] },
  { id: "tencentcloud", labelKey: "model.catalog.tencentcloud", icon: "tencentcloud", aliases: ["tencentcloud"] },
  { id: "wenxin", labelKey: "model.catalog.wenxin", icon: "wenxin", aliases: ["wenxin", "ernie", "baidu"] },
  { id: "qiniu", labelKey: "model.catalog.qiniu", icon: "qiniu", aliases: ["qiniu"] },
  { id: "newapi", label: "New API", icon: "newapi", aliases: ["newapi"] },
  { id: "xinference", label: "Xinference", icon: "xinference", aliases: ["xinference"] },
];

const SORTED_MODEL_CATALOG = [...MODEL_CATALOG].sort((left, right) => {
  const kindWeight = (value: ModelCatalogMatchKind): number => (value === "exact" ? 3 : value === "prefix" ? 2 : 1);
  return (
    kindWeight(right.match) - kindWeight(left.match) ||
    Math.max(...right.values.map((value) => value.length)) - Math.max(...left.values.map((value) => value.length))
  );
});

const SORTED_PROVIDER_CATALOG = [...PROVIDER_CATALOG].sort(
  (left, right) =>
    Math.max(...right.aliases.map((value) => value.length)) - Math.max(...left.aliases.map((value) => value.length)),
);

export function normalizeModelCatalogValue(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\\/gu, "/")
    .replace(/\s+/gu, "-")
    .replace(/^models?:/u, "")
    .replace(/^deployment:/u, "");
}

export function inferModelCatalogRule(modelName: string | undefined): ModelCatalogRule | undefined {
  const source = normalizeModelCatalogValue(modelName);
  if (!source) return undefined;
  return SORTED_MODEL_CATALOG.find((rule) => modelCatalogRuleMatches(rule.match, source, rule.values));
}

export function inferModelCatalogProvider(providerHint: string | undefined): ProviderCatalogRule | undefined {
  const source = normalizeModelCatalogValue(providerHint);
  if (!source) return undefined;
  // models.dev labels experimental labs as <brand>-labs (openai-labs,
  // google-labs, ...). These must resolve to their own Labs group instead of
  // matching the parent provider's alias via substring containment.
  if (/-labs$/u.test(source)) {
    return { id: "labs", label: "Labs", icon: "labs", aliases: [] };
  }
  return SORTED_PROVIDER_CATALOG.find((rule) =>
    rule.aliases.some(
      (alias) =>
        source === alias || source.startsWith(`${alias}-`) || source.includes(`/${alias}/`) || source.includes(alias),
    ),
  );
}

export function inferModelCatalogIcon(modelName?: string, providerHint?: string): string | undefined {
  return inferModelCatalogRule(modelName)?.icon ?? inferModelCatalogProvider(providerHint)?.icon;
}

export function inferProviderCatalogIcon(providerHint?: string): string | undefined {
  return inferModelCatalogProvider(providerHint)?.icon;
}

export function inferModelCatalogGroup(modelName?: string, providerHint?: string): ModelCatalogGroup | undefined {
  const modelRule = inferModelCatalogRule(modelName);
  if (modelRule) {
    return { id: modelRule.id, label: resolveCatalogLabel(modelRule), icon: modelRule.icon };
  }
  const provider = inferModelCatalogProvider(providerHint);
  return provider ? { id: provider.id, label: resolveCatalogLabel(provider), icon: provider.icon } : undefined;
}

function resolveCatalogLabel(rule: { label?: string; labelKey?: FrontendMessageKey }): string {
  return rule.labelKey ? frontendMessage(rule.labelKey) : (rule.label ?? "");
}

export function inferModelCatalogCapabilities(
  modelName?: string,
  _providerHint?: string,
): Partial<ModelCapabilitiesDraft> {
  const modelRule = inferModelCatalogRule(modelName);
  const capabilities: Partial<ModelCapabilitiesDraft> = { ...(modelRule?.capabilities ?? {}) };
  const source = normalizeModelCatalogValue(modelName);
  const setTrue = (key: keyof ModelCapabilitiesDraft): void => {
    capabilities[key] = true;
  };
  const setFalse = (key: keyof ModelCapabilitiesDraft): void => {
    capabilities[key] = false;
  };

  const isRerankModel = matchesAny(source, ["rerank", "re-rank", "ranker", "cross-encoder"]);
  const isEmbeddingModel =
    !isRerankModel &&
    matchesAny(source, [
      "embedding",
      "embed-",
      "text2vec",
      "bge-",
      "bge_",
      "e5-",
      "gte-",
      "mxbai",
      "nomic-embed",
      "voyage-",
    ]);
  if (isEmbeddingModel) {
    setTrue("Embedding");
    capabilities.Chat = false;
    setFalse("Vision");
    setFalse("ImageOutput");
    setFalse("ToolCalling");
  }
  if (isRerankModel) {
    setTrue("Rerank");
    capabilities.Chat = false;
    setFalse("Vision");
    setFalse("ImageOutput");
    setFalse("ToolCalling");
  }
  if (
    !isEmbeddingModel &&
    !isRerankModel &&
    matchesAny(source, [
      "gemini",
      "gemma-3",
      "claude-3",
      "claude-sonnet-4",
      "claude-opus-4",
      "claude-haiku-4",
      "gpt-4o",
      "gpt-4.1",
      "grok-2-vision",
      "grok-vision",
      "o1",
      "o3",
      "o4",
      "qwen-vl",
      "qwen2-vl",
      "qwen2.5-vl",
      "qwen3-vl",
      "qwen-omni",
      "kimi-vl",
      "glm-4v",
      "llava",
      "internvl",
      "minicpm-v",
      "pixtral",
      "vision",
      "-vl",
      "_vl",
      "omni",
    ])
  ) {
    setTrue("Vision");
  }
  if (
    matchesAny(source, ["dall-e", "gpt-image", "imagen", "flux", "stable-diffusion", "sdxl", "cogview", "ideogram"])
  ) {
    setTrue("ImageOutput");
  }
  if (
    matchesAny(source, ["o1", "o3", "o4", "deepseek-reasoner", "deepseek-r1", "qwq", "thinking", "reasoning", "-r1"])
  ) {
    setTrue("Reasoning");
  }
  return capabilities;
}

function modelCatalogRuleMatches(match: ModelCatalogMatchKind, source: string, values: readonly string[]): boolean {
  return values.some((value) => {
    const normalized = normalizeModelCatalogValue(value);
    if (match === "exact") return source === normalized;
    if (match === "prefix") return source.startsWith(normalized);
    return source.includes(normalized);
  });
}

function matchesAny(source: string, values: readonly string[]): boolean {
  return values.some((value) => source.includes(normalizeModelCatalogValue(value)));
}
