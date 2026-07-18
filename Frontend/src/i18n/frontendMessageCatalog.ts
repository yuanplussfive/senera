import FrontendMessagesEnUs from "./messages/en-US.json" with { type: "json" };
import FrontendMessagesZhCn from "./messages/zh-CN.json" with { type: "json" };
import { FrontendLocales, type FrontendLocale } from "./frontendLocaleModel.js";
import { getFrontendLocale } from "./frontendLocaleStore.js";

export { FrontendDefaultLocale, FrontendLocales, isFrontendLocale, resolveFrontendLocale } from "./frontendLocaleModel.js";
export type { FrontendLocale } from "./frontendLocaleModel.js";
export type FrontendMessageKey = keyof typeof FrontendMessagesZhCn;
export type FrontendMessageParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

const FrontendMessageCatalog = {
  [FrontendLocales.ZhCn]: FrontendMessagesZhCn,
  [FrontendLocales.EnUs]: FrontendMessagesEnUs,
} as const satisfies Record<FrontendLocale, Record<FrontendMessageKey, string>>;

export function frontendMessage(
  key: FrontendMessageKey,
  params: FrontendMessageParams = {},
  locale: FrontendLocale = getFrontendLocale(),
): string {
  return formatFrontendMessage(FrontendMessageCatalog[locale][key], params);
}

export function formatFrontendMessage(template: string, params: FrontendMessageParams): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}
