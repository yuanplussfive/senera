import { describe, expect, it } from "vitest";
import {
  isDefaultAppearancePreference,
  readAppearanceTokenRows,
} from "../../../Frontend/src/shared/theme/appearancePresentation.ts";
import { defaultAppearancePreference } from "../../../Frontend/src/shared/theme/themeModel.ts";
describe("appearancePresentation", () => {
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
