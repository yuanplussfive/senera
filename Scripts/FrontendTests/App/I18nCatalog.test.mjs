import { expect, test } from "vitest";
import enUsMessages from "../../../Frontend/src/i18n/messages/en-US.json" with { type: "json" };
import zhCnMessages from "../../../Frontend/src/i18n/messages/zh-CN.json" with { type: "json" };
import enUsChatMessages from "../../../Frontend/src/i18n/messages/chat.en-US.json" with { type: "json" };
import zhCnChatMessages from "../../../Frontend/src/i18n/messages/chat.zh-CN.json" with { type: "json" };
import enUsFeatureMessages from "../../../Frontend/src/i18n/messages/feature.en-US.json" with { type: "json" };
import zhCnFeatureMessages from "../../../Frontend/src/i18n/messages/feature.zh-CN.json" with { type: "json" };
import {
  FrontendDefaultLocale,
  FrontendLocales,
  formatFrontendMessage,
  frontendMessage,
  resolveFrontendLocale,
} from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

test("frontend i18n catalogs expose the same message keys across locales", () => {
  for (const [enUs, zhCn] of [
    [enUsMessages, zhCnMessages],
    [enUsChatMessages, zhCnChatMessages],
    [enUsFeatureMessages, zhCnFeatureMessages],
  ]) {
    const expectedKeys = Object.keys(zhCn).sort();
    expect(Object.keys(enUs).sort()).toEqual(expectedKeys);
    expect(new Set(expectedKeys).size).toBe(expectedKeys.length);
  }
});

test("frontend i18n resolves supported locales and falls back to default", () => {
  expect(resolveFrontendLocale(FrontendLocales.EnUs)).toBe(FrontendLocales.EnUs);
  expect(resolveFrontendLocale("fr-FR")).toBe(FrontendDefaultLocale);
  expect(frontendMessage("app.errorBoundary.title")).toBe("界面暂时无法继续显示");
  expect(frontendMessage("ui.close", {}, FrontendLocales.EnUs)).toBe("Close");
  expect(frontendMessage("session.hydrated", { count: 3 })).toBe("恢复 3 个会话");
  expect(frontendMessage("session.hydrated", { count: 3 }, FrontendLocales.EnUs)).toBe("Restored 3 sessions");
});

test("frontend message formatting preserves unknown placeholders", () => {
  expect(formatFrontendMessage("{known} {missing}", { known: "ok" })).toBe("ok {missing}");
});
