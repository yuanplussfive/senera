import vm from "node:vm";
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
import { recommendedAccentColors } from "../../../Frontend/src/shared/theme/themeData.ts";

describe("themeBootstrap", () => {
  it("derives early bootstrap values from the shared appearance contract", () => {
    const config = createAppearanceBootstrapConfig();
    expect(config).toMatchObject({
      storageKey: appearancePreferenceStorageKey,
      defaultPreference: defaultAppearancePreference,
      validPreferenceValues: {
        themeMode: [...themeModes],
        colorScheme: [...colorSchemes],
        accentColor: [...accentColors],
        fontFamily: [...appearanceFontFamilies],
        fontScale: [...fontScales],
      },
      accentColorByScheme: recommendedAccentColors,
    });
    expect(config.firstPaintTokens.classic.dark["--theme-skeleton-a"]).toBe("rgb(239 235 223 / 0.045)");
  });

  it("serializes a self-contained early bootstrap script", () => {
    const script = createAppearanceBootstrapScript();
    expect(script).toContain(appearancePreferenceStorageKey);
    expect(script).toContain("document.documentElement");
    expect(script).toContain('"colorScheme":"classic"');
    expect(script).toContain("--theme-skeleton-a");
    expect(script).toContain("style.setProperty");
  });

  it("applies dark first-paint tokens before the application bundle runs", () => {
    const values = new Map([
      [appearancePreferenceStorageKey, JSON.stringify({ themeMode: "dark", colorScheme: "ocean" })],
    ]);
    const root = {
      dataset: {},
      style: {
        colorScheme: "",
        setProperty: (key, value) => values.set(key, value),
      },
    };

    vm.runInNewContext(createAppearanceBootstrapScript(), {
      document: { documentElement: root },
      window: {
        localStorage: { getItem: (key) => values.get(key) ?? null },
        matchMedia: () => ({ matches: false }),
      },
      Object,
      JSON,
    });

    expect(root.dataset.theme).toBe("dark");
    expect(values.get("--theme-bg")).toBe("rgb(33 37 39)");
    expect(values.get("--theme-skeleton-a")).toBe("rgb(228 237 243 / 0.045)");
  });
});
