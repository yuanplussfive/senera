import { describe, expect, it } from "vitest";
import { resolveBackendMessage } from "../../../Frontend/src/i18n/backendMessage.ts";
import { FrontendLocales } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

const localizedPayload = {
  message: "配置操作失败。",
  localizedMessage: {
    key: "config.operationFailed",
    params: {},
    text: {
      "zh-CN": "配置操作失败。",
      "en-US": "The configuration operation failed.",
    },
  },
};

describe("backend message resolution", () => {
  it("selects the text matching the active frontend locale", () => {
    expect(resolveBackendMessage(localizedPayload, FrontendLocales.ZhCn)).toBe("配置操作失败。");
    expect(resolveBackendMessage(localizedPayload, FrontendLocales.EnUs)).toBe("The configuration operation failed.");
  });

  it("supports legacy events and malformed optional localized payloads", () => {
    expect(resolveBackendMessage({ message: "legacy failure" }, FrontendLocales.EnUs)).toBe("legacy failure");
    expect(
      resolveBackendMessage(
        { message: "legacy failure", localizedMessage: { text: { "en-US": 42 } } },
        FrontendLocales.EnUs,
      ),
    ).toBe("legacy failure");
  });

  it("preserves detailed compatibility text in the backend default locale", () => {
    const unknownFailure = {
      message: "配置文件第 42 行无效。",
      localizedMessage: {
        key: "config.operationFailed",
        params: {},
        text: {
          "zh-CN": "配置操作失败。",
          "en-US": "The configuration operation failed.",
        },
      },
    };

    expect(resolveBackendMessage(unknownFailure, FrontendLocales.ZhCn)).toBe("配置文件第 42 行无效。");
    expect(resolveBackendMessage(unknownFailure, FrontendLocales.EnUs)).toBe("The configuration operation failed.");
  });
});
