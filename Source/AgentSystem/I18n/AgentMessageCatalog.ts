import AgentErrorMessagesEnUs from "./messages.en-US.json" with { type: "json" };
import AgentErrorMessagesZhCn from "./messages.zh-CN.json" with { type: "json" };

export const AgentLocales = {
  ZhCn: "zh-CN",
  EnUs: "en-US",
} as const;

export type AgentLocale = (typeof AgentLocales)[keyof typeof AgentLocales];
export type AgentErrorMessageKey = keyof typeof AgentErrorMessagesZhCn;
export type AgentMessageParam = string | number | boolean | null;
export type AgentMessageParams = Readonly<Record<string, AgentMessageParam | undefined>>;
export type AgentLocalizedMessageParams = Readonly<Record<string, AgentMessageParam>>;

export interface AgentLocalizedMessage {
  readonly key: AgentErrorMessageKey;
  readonly params: AgentLocalizedMessageParams;
  readonly text: Readonly<Record<AgentLocale, string>>;
}

export const AgentDefaultLocale = AgentLocales.ZhCn;
export const AgentLocaleValues = Object.values(AgentLocales) as readonly AgentLocale[];

const AgentErrorMessageCatalog = {
  [AgentLocales.ZhCn]: AgentErrorMessagesZhCn,
  [AgentLocales.EnUs]: AgentErrorMessagesEnUs,
} as const satisfies Record<AgentLocale, Record<AgentErrorMessageKey, string>>;

export function agentErrorMessage(
  key: AgentErrorMessageKey,
  params: AgentMessageParams = {},
  locale: AgentLocale = AgentDefaultLocale,
): string {
  return formatAgentMessage(readAgentErrorMessageTemplate(key, locale), params);
}

export function readAgentErrorMessageTemplate(
  key: AgentErrorMessageKey,
  locale: AgentLocale = AgentDefaultLocale,
): string {
  return AgentErrorMessageCatalog[locale][key];
}

export function projectAgentLocalizedMessage(
  key: AgentErrorMessageKey,
  params: AgentMessageParams = {},
): AgentLocalizedMessage {
  const normalizedParams = normalizeAgentMessageParams(params);
  const text = Object.fromEntries(
    AgentLocaleValues.map((locale) => [locale, agentErrorMessage(key, normalizedParams, locale)]),
  ) as Record<AgentLocale, string>;
  return { key, params: normalizedParams, text };
}

export function normalizeAgentMessageParams(params: AgentMessageParams): AgentLocalizedMessageParams {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, AgentMessageParam] => entry[1] !== undefined),
  );
}

export function isAgentErrorMessageKey(value: unknown): value is AgentErrorMessageKey {
  return typeof value === "string" && Object.hasOwn(AgentErrorMessagesZhCn, value);
}

export function readAgentLocalizedMessage(value: unknown): AgentLocalizedMessage | undefined {
  if (!isRecord(value) || !isAgentErrorMessageKey(value.key) || !isRecord(value.params) || !isRecord(value.text)) {
    return undefined;
  }
  const rawParams = value.params;
  const rawText = value.text;
  const params = Object.fromEntries(
    Object.entries(rawParams).filter((entry): entry is [string, AgentMessageParam] => isAgentMessageParam(entry[1])),
  );
  if (Object.keys(params).length !== Object.keys(rawParams).length) return undefined;

  const textEntries = AgentLocaleValues.map((locale) => [locale, rawText[locale]] as const);
  if (textEntries.some((entry) => typeof entry[1] !== "string")) return undefined;
  return {
    key: value.key,
    params,
    text: Object.fromEntries(textEntries) as Record<AgentLocale, string>,
  };
}

export function formatAgentMessage(template: string, params: AgentMessageParams): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentMessageParam(value: unknown): value is AgentMessageParam {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
