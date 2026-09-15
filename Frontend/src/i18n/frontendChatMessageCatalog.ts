import FrontendChatMessagesEnUs from "./messages/chat.en-US.json" with { type: "json" };
import FrontendChatMessagesZhCn from "./messages/chat.zh-CN.json" with { type: "json" };
import { FrontendLocales, type FrontendLocale } from "./frontendLocaleModel.js";
import { getFrontendLocale } from "./frontendLocaleStore.js";
import { formatFrontendMessage, type FrontendMessageParams } from "./frontendMessageCatalog.js";

export type FrontendChatMessageKey = keyof typeof FrontendChatMessagesZhCn;

const FrontendChatMessageCatalog = {
  [FrontendLocales.ZhCn]: FrontendChatMessagesZhCn,
  [FrontendLocales.EnUs]: FrontendChatMessagesEnUs,
} as const satisfies Record<FrontendLocale, Record<FrontendChatMessageKey, string>>;

export function frontendChatMessage(
  key: FrontendChatMessageKey,
  params: FrontendMessageParams = {},
  locale: FrontendLocale = getFrontendLocale(),
): string {
  return formatFrontendMessage(FrontendChatMessageCatalog[locale][key], params);
}
