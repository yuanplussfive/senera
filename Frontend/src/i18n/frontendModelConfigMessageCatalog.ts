import FrontendModelConfigMessagesEnUs from "./messages/model-config.en-US.json" with { type: "json" };
import FrontendModelConfigMessagesZhCn from "./messages/model-config.zh-CN.json" with { type: "json" };
import { FrontendLocales, type FrontendLocale } from "./frontendLocaleModel.js";
import { getFrontendLocale } from "./frontendLocaleStore.js";
import { formatFrontendMessage, type FrontendMessageParams } from "./frontendMessageCatalog.js";

export type FrontendModelConfigMessageKey = keyof typeof FrontendModelConfigMessagesZhCn;

const FrontendModelConfigMessageCatalog = {
  [FrontendLocales.ZhCn]: FrontendModelConfigMessagesZhCn,
  [FrontendLocales.EnUs]: FrontendModelConfigMessagesEnUs,
} as const satisfies Record<FrontendLocale, Record<FrontendModelConfigMessageKey, string>>;

export function frontendModelConfigMessage(
  key: FrontendModelConfigMessageKey,
  params: FrontendMessageParams = {},
  locale: FrontendLocale = getFrontendLocale(),
): string {
  return formatFrontendMessage(FrontendModelConfigMessageCatalog[locale][key], params);
}
