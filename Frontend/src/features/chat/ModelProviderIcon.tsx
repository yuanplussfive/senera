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
      className={cn("shrink-0", className)}
      decoding="async"
      draggable={false}
      loading="lazy"
      style={style}
    />
  );
}

export function readModelProviderIconSrc(icon: string, baseUrl: string = import.meta.env.BASE_URL): string {
  if (icon.startsWith("/")) return icon;
  const assetName = icon.endsWith(".svg") ? icon : `${icon}.svg`;
  return `${withTrailingSlash(baseUrl)}icons/model-providers/${assetName}`;
}

export function inferModelProviderIcon(value: string): ModelProviderIconName | undefined {
  const normalized = value.toLowerCase();
  return (
    ModelProviderIconRuleConfig.rules.find((rule) => iconRuleMatches(rule.match, normalized, rule.values))?.icon ??
    ModelProviderIconRuleConfig.defaultIcon
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
