import { cn } from "../../lib/util";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import iconRules from "./ModelProviderIconRules.json";

type IconRuleMatchKind = "exact" | "prefix" | "suffix" | "includes";

export type ModelProviderRuleMatchKind = IconRuleMatchKind;

export interface ModelProviderModelGroupRule {
  id: string;
  label: string;
  icon?: string;
  match: ModelProviderRuleMatchKind;
  values: string[];
}

export interface ModelProviderDefaultModelGroup {
  id: string;
  label: string;
  icon?: string;
}

interface ModelProviderIconRuleDocument {
  defaultIcon?: string;
  icons: string[];
  rules: Array<{
    icon: string;
    match: IconRuleMatchKind;
    values: string[];
  }>;
  modelGroups?: ModelProviderModelGroupRule[];
  defaultModelGroup?: {
    id: string;
    label?: string;
    labelKey?: FrontendMessageKey;
    icon?: string;
  };
}

const ModelProviderIconRuleConfig = iconRules as ModelProviderIconRuleDocument;

export const ModelProviderIconNames = ModelProviderIconRuleConfig.icons;
const ModelProviderIconNameSet = new Set(ModelProviderIconNames);
const DefaultModelProviderIconName =
  ModelProviderIconRuleConfig.defaultIcon && ModelProviderIconNameSet.has(ModelProviderIconRuleConfig.defaultIcon)
    ? ModelProviderIconRuleConfig.defaultIcon
    : (ModelProviderIconNames[0] ?? "openai");

const ModelProviderEndpointIconAliases: readonly (readonly [string, string])[] = [
  ["openai-labs", "labs"],
  ["google-labs", "labs"],
  ["anthropic-labs", "labs"],
  ["labs", "labs"],
  ["siliconflow", "siliconcloud"],
  ["openrouter", "openrouter"],
  ["fireworksai", "fireworks"],
  ["cloudflare", "cloudflare"],
  ["huggingface", "huggingface"],
  ["modelscope", "modelscope"],
  ["tencentcloud", "tencentcloud"],
  ["volcengine", "volcengine"],
  ["xinference", "xinference"],
  ["sambanova", "sambanova"],
  ["search1api", "search1api"],
  ["siliconcloud", "siliconcloud"],
  ["togetherai", "together"],
  ["vertexai", "vertexai"],
  ["newapi", "newapi"],
  ["aihubmix", "aihubmix"],
  ["xai", "xai"],
  ["grok", "grok"],
  ["openai", "openai"],
  ["anthropic", "anthropic"],
  ["deepseek", "deepseek"],
  ["azure", "azure"],
  ["google", "google"],
  ["mistral", "mistral"],
  ["qwen", "qwen"],
  ["llama", "meta"],
  ["meta", "meta"],
  ["moonshot", "moonshot"],
  ["kimi", "kimi"],
  ["zhipu", "zhipu"],
  ["glm", "zhipu"],
  ["minimax", "minimax"],
  ["doubao", "doubao"],
  ["baichuan", "baichuan"],
  ["cohere", "cohere"],
  ["ollama", "ollama"],
  ["perplexity", "perplexity"],
  ["groq", "groq"],
  ["bedrock", "bedrock"],
  ["aws", "bedrock"],
  ["nvidia", "nvidia"],
  ["lmstudio", "lmstudio"],
  ["vllm", "vllm"],
  ["jina", "jina"],
  ["sensenova", "sensenova"],
  ["stepfun", "stepfun"],
  ["spark", "spark"],
  ["upstage", "upstage"],
  ["wenxin", "wenxin"],
  ["ernie", "wenxin"],
  ["qiniu", "qiniu"],
  ["ppio", "ppio"],
  ["sophnet", "sophnet"],
  ["hunyuan", "hunyuan"],
  ["internlm", "internlm"],
  ["ai21", "ai21"],
  ["jamba", "ai21"],
];

export type ModelProviderIconName = string;

interface ModelProviderIconProps {
  icon?: string;
  className?: string;
  size?: number;
}

export function ModelProviderIcon({ icon, className, size = 16 }: ModelProviderIconProps): JSX.Element | null {
  if (!icon) return null;

  const style = { height: size, width: size };
  return (
    <img
      src={readModelProviderIconSrc(icon)}
      alt=""
      aria-hidden="true"
      className={cn("block shrink-0 object-contain align-middle", className)}
      decoding="async"
      draggable={false}
      loading="lazy"
      style={style}
    />
  );
}

export function readModelProviderIconSrc(icon: string, baseUrl: string = import.meta.env.BASE_URL): string {
  const customSource = readCustomModelProviderIconSource(icon);
  if (customSource) return customSource;

  const assetName = normalizeModelProviderIconName(icon);
  return `${withTrailingSlash(baseUrl)}icons/model-providers/${encodeURIComponent(assetName)}.svg`;
}

/**
 * Provider marks may point at a user-owned image. Keep this deliberately
 * narrow: the value is ultimately assigned to an <img> src, so only image
 * URLs, data images, and same-origin paths are accepted as custom sources.
 */
export function readCustomModelProviderIconSource(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  if ([...candidate].some((character) => isUnsafeCustomIconCharacter(character))) return undefined;
  if (/^https?:\/\//iu.test(candidate) || /^data:image\//iu.test(candidate) || candidate.startsWith("/")) {
    return candidate;
  }
  return undefined;
}

function isUnsafeCustomIconCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint === undefined ||
    (codePoint >= 0 && codePoint <= 0x1f) ||
    codePoint === 0x22 ||
    codePoint === 0x27 ||
    codePoint === 0x3c ||
    codePoint === 0x3e ||
    codePoint === 0x60
  );
}

export function inferModelProviderIcon(value: string, fallbackToDefault = true): ModelProviderIconName | undefined {
  const normalized = value.trim().toLowerCase();
  const match = ModelProviderIconRuleConfig.rules.find((rule) => iconRuleMatches(rule.match, normalized, rule.values));
  const aliased = ModelProviderEndpointIconAliases.find(([alias]) => normalized.includes(alias))?.[1];
  return match?.icon ?? aliased ?? (fallbackToDefault ? ModelProviderIconRuleConfig.defaultIcon : undefined);
}

export function inferModelProviderEndpointIcon(
  value: string,
  fallbackToDefault = false,
): ModelProviderIconName | undefined {
  const normalized = value.trim().toLowerCase();
  return (
    ModelProviderEndpointIconAliases.find(([alias]) => normalized.includes(alias))?.[1] ??
    inferModelProviderIcon(value, fallbackToDefault)
  );
}

export function readDefaultModelGroupRules(): ModelProviderModelGroupRule[] {
  return ModelProviderIconRuleConfig.modelGroups ?? [];
}

export function readDefaultModelGroup(): ModelProviderDefaultModelGroup {
  const configured = ModelProviderIconRuleConfig.defaultModelGroup;
  if (configured) {
    return {
      id: configured.id,
      label: configured.labelKey
        ? frontendMessage(configured.labelKey)
        : (configured.label ?? frontendMessage("config.modelGroups.other")),
      icon: configured.icon,
    };
  }
  return {
    id: "other",
    label: frontendMessage("config.modelGroups.other"),
    icon: ModelProviderIconRuleConfig.defaultIcon,
  };
}

function iconRuleMatches(match: IconRuleMatchKind, source: string, values: readonly string[]): boolean {
  return values.some((value) => {
    const normalized = value.toLowerCase();
    switch (match) {
      case "exact":
        return source === normalized;
      case "prefix":
        return source.startsWith(normalized);
      case "suffix":
        return source.endsWith(normalized);
      case "includes":
        return source.includes(normalized);
    }
  });
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeModelProviderIconName(value: string): string {
  const candidate = value
    .trim()
    .toLowerCase()
    .replace(/\.svg$/u, "");
  return ModelProviderIconNameSet.has(candidate) ? candidate : DefaultModelProviderIconName;
}
