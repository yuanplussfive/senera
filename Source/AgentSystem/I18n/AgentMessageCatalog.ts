import AgentErrorMessagesZhCn from "./messages.zh-CN.json" with { type: "json" };

export const AgentLocales = {
  ZhCn: "zh-CN",
} as const;

export type AgentLocale = (typeof AgentLocales)[keyof typeof AgentLocales];
export type AgentErrorMessageKey = keyof typeof AgentErrorMessagesZhCn;
export type AgentMessageParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

const AgentErrorMessageCatalog = {
  [AgentLocales.ZhCn]: AgentErrorMessagesZhCn,
} as const satisfies Record<AgentLocale, Record<AgentErrorMessageKey, string>>;

export function agentErrorMessage(
  key: AgentErrorMessageKey,
  params: AgentMessageParams = {},
  locale: AgentLocale = AgentLocales.ZhCn,
): string {
  return formatAgentMessage(readAgentErrorMessageTemplate(key, locale), params);
}

export function readAgentErrorMessageTemplate(
  key: AgentErrorMessageKey,
  locale: AgentLocale = AgentLocales.ZhCn,
): string {
  return AgentErrorMessageCatalog[locale][key];
}

export function formatAgentMessage(template: string, params: AgentMessageParams): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}
