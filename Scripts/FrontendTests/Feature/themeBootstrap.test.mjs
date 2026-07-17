import { describe, expect, it } from "vitest";
import {
  accentColors,
  appearanceFontFamilies,
  appearancePreferenceStorageKey,
  colorSchemes,
  defaultAppearancePreference,
  fontScales,
  themeModes,
} from "../../../Frontend/src/shared/theme/themeModel.ts";
import {
  createAppearanceBootstrapConfig,
  createAppearanceBootstrapScript,
} from "../../../Frontend/src/shared/theme/themeBootstrap.ts";

describe("themeBootstrap", () => {
  it("derives early bootstrap values and migration aliases from the shared appearance contract", () => {
    expect(createAppearanceBootstrapConfig()).toEqual({
      storageKey: appearancePreferenceStorageKey,
      defaultPreference: defaultAppearancePreference,
      validPreferenceValues: {
        themeMode: [...themeModes],
        colorScheme: [...colorSchemes],
        accentColor: [...accentColors],
        fontFamily: [...appearanceFontFamilies],
        fontScale: [...fontScales],
      },
      legacyPreferenceValues: {
        colorScheme: {
          monochrome: "mono",
          nordic: "classic",
          sepia: "honey",
        },
      },
    });
  });

  it("serializes a self-contained early bootstrap script", () => {
    const script = createAppearanceBootstrapScript();
    expect(script).toContain(appearancePreferenceStorageKey);
    expect(script).toContain("document.documentElement");
    expect(script).toContain('"colorScheme":"classic"');
    expect(script).toContain('"sepia":"honey"');
  });
});
