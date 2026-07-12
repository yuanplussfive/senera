import FrontendMessagesEnUs from "./messages/en-US.json" with { type: "json" };
import FrontendMessagesZhCn from "./messages/zh-CN.json" with { type: "json" };

export const FrontendLocales = {
  ZhCn: "zh-CN",
  EnUs: "en-US",
} as const;

export type FrontendLocale = (typeof FrontendLocales)[keyof typeof FrontendLocales];
export type FrontendMessageKey = keyof typeof FrontendMessagesZhCn;
export type FrontendMessageParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

export const FrontendDefaultLocale = FrontendLocales.ZhCn;

const FrontendMessageCatalog = {
  [FrontendLocales.ZhCn]: FrontendMessagesZhCn,
  [FrontendLocales.EnUs]: FrontendMessagesEnUs,
} as const satisfies Record<FrontendLocale, Record<FrontendMessageKey, string>>;

export function frontendMessage(
  key: FrontendMessageKey,
  params: FrontendMessageParams = {},
  locale: FrontendLocale = FrontendDefaultLocale,
): string {
  return formatFrontendMessage(FrontendMessageCatalog[locale][key], params);
}

export function isFrontendLocale(value: string): value is FrontendLocale {
  return Object.values(FrontendLocales).includes(value as FrontendLocale);
}

export function resolveFrontendLocale(value: string | null | undefined): FrontendLocale {
  return value && isFrontendLocale(value) ? value : FrontendDefaultLocale;
}

export function formatFrontendMessage(template: string, params: FrontendMessageParams): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}
