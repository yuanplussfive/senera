import { FrontendMessagesZhCn } from "./frontendMessages.zh-CN.js";

export const FrontendLocales = {
  ZhCn: "zh-CN",
} as const;

export type FrontendLocale = typeof FrontendLocales[keyof typeof FrontendLocales];
export type FrontendMessageKey = keyof typeof FrontendMessagesZhCn;
export type FrontendMessageParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

const FrontendMessageCatalog = {
  [FrontendLocales.ZhCn]: FrontendMessagesZhCn,
} as const satisfies Record<FrontendLocale, Record<FrontendMessageKey, string>>;

export function frontendMessage(
  key: FrontendMessageKey,
  params: FrontendMessageParams = {},
  locale: FrontendLocale = FrontendLocales.ZhCn,
): string {
  return formatFrontendMessage(FrontendMessageCatalog[locale][key], params);
}

export function formatFrontendMessage(
  template: string,
  params: FrontendMessageParams,
): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}
