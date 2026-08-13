import FrontendFeatureMessagesEnUs from "./messages/feature.en-US.json" with { type: "json" };
import FrontendFeatureMessagesZhCn from "./messages/feature.zh-CN.json" with { type: "json" };
import { FrontendLocales, type FrontendLocale } from "./frontendLocaleModel.js";
import { getFrontendLocale } from "./frontendLocaleStore.js";
import { formatFrontendMessage, type FrontendMessageParams } from "./frontendMessageCatalog.js";

export type FrontendFeatureMessageKey = keyof typeof FrontendFeatureMessagesZhCn;

const FrontendFeatureMessageCatalog = {
  [FrontendLocales.ZhCn]: FrontendFeatureMessagesZhCn,
  [FrontendLocales.EnUs]: FrontendFeatureMessagesEnUs,
} as const satisfies Record<FrontendLocale, Record<FrontendFeatureMessageKey, string>>;

export function frontendFeatureMessage(
  key: FrontendFeatureMessageKey,
  params: FrontendMessageParams = {},
  locale: FrontendLocale = getFrontendLocale(),
): string {
  return formatFrontendMessage(FrontendFeatureMessageCatalog[locale][key], params);
}

export function isFrontendFeatureMessageKey(value: unknown): value is FrontendFeatureMessageKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FrontendFeatureMessagesZhCn, value);
}
