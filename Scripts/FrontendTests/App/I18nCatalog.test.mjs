import { expect, test } from "vitest";
import enUsMessages from "../../../Frontend/src/i18n/messages/en-US.json" with { type: "json" };
import zhCnMessages from "../../../Frontend/src/i18n/messages/zh-CN.json" with { type: "json" };
import {
  FrontendDefaultLocale,
  FrontendLocales,
  formatFrontendMessage,
  frontendMessage,
  resolveFrontendLocale,
} from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

test("frontend i18n catalogs expose the same message keys across locales", () => {
  const expectedKeys = Object.keys(zhCnMessages).sort();

  expect(Object.keys(enUsMessages).sort()).toEqual(expectedKeys);
  expect(new Set(expectedKeys).size).toBe(expectedKeys.length);
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
