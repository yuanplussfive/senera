import { describe, expect, it } from "vitest";
import { FrontendLocales } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { setFrontendLocale } from "../../../Frontend/src/i18n/frontendLocaleStore.ts";
import {
  createAppearanceSummary,
  isDefaultAppearancePreference,
  readAppearanceTokenRows,
} from "../../../Frontend/src/shared/theme/appearancePresentation.ts";
import { defaultAppearancePreference } from "../../../Frontend/src/shared/theme/themeModel.ts";
describe("appearancePresentation", () => {
  it("creates a stable Chinese summary for the active appearance preference", () => {
    const preference = {
      themeMode: "dark",
      colorScheme: "senera",
      accentColor: "moss",
      fontFamily: "system",
      fontScale: "large",
    };
    expect(createAppearanceSummary(preference)).toEqual([
      { id: "themeMode", label: "主题", value: "深色" },
      { id: "colorScheme", label: "配色", value: "暖纸" },
      { id: "accentColor", label: "强调色", value: "苔绿" },
      { id: "fontFamily", label: "字体", value: "系统" },
      { id: "fontScale", label: "字号", value: "大字" },
    ]);
  });
  it("uses English field and value labels for an English appearance summary", () => {
    setFrontendLocale(FrontendLocales.EnUs);
    const preference = {
      themeMode: "dark",
      colorScheme: "senera",
      accentColor: "moss",
      fontFamily: "system",
      fontScale: "large",
    };
    expect(createAppearanceSummary(preference)).toEqual([
      { id: "themeMode", label: "Theme", value: "Dark" },
      { id: "colorScheme", label: "Color scheme", value: "Warm paper" },
      { id: "accentColor", label: "Accent color", value: "Moss" },
      { id: "fontFamily", label: "Font", value: "System" },
      { id: "fontScale", label: "Text size", value: "Large" },
    ]);
  });
  it("detects whether a preference still uses the default appearance contract", () => {
    expect(isDefaultAppearancePreference(defaultAppearancePreference)).toBe(true);
    expect(
      isDefaultAppearancePreference({
        ...defaultAppearancePreference,
        accentColor: "violet",
      }),
    ).toBe(false);
  });
  it("describes the DOM token rows exposed by the appearance system", () => {
    expect(
      readAppearanceTokenRows({
        ...defaultAppearancePreference,
        themeMode: "dark",
        colorScheme: "classic",
        accentColor: "sky",
        fontScale: "compact",
      }),
    ).toEqual([
      { label: "data-theme-preference", value: "dark" },
      { label: "data-color-scheme", value: "classic" },
      { label: "data-accent-color", value: "sky" },
      { label: "data-font-family", value: "brand" },
      { label: "data-font-scale", value: "compact" },
    ]);
  });
});
