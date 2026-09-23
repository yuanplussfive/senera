import {
  accentColors,
  appearanceFontFamilies,
  appearancePreferenceStorageKey,
  colorSchemes,
  createAppearanceTokens,
  defaultAppearancePreference,
  fontScales,
  themeModes,
  type AppearancePreference,
  type ColorScheme,
  type ResolvedTheme,
} from "./themeModel";
import { recommendedAccentColors } from "./themeData";

export const appearanceBootstrapScriptPlaceholder = "__SENERA_APPEARANCE_BOOTSTRAP_SCRIPT__";

export interface AppearanceBootstrapConfig {
  storageKey: string;
  defaultPreference: AppearancePreference;
  validPreferenceValues: {
    themeMode: string[];
    colorScheme: string[];
    accentColor: string[];
    fontFamily: string[];
    fontScale: string[];
  };
  accentColorByScheme: Record<string, string>;
  firstPaintTokens: Record<ColorScheme, Record<ResolvedTheme, Record<string, string>>>;
}

// Keep the pre-app fallback themed without moving the full theme store into the bootstrap chunk.
const firstPaintCssVariableNames = [
  "--color-paper-50",
  "--color-paper-100",
  "--color-paper-200",
  "--color-ink-950",
  "--color-ink-900",
  "--color-ink-200",
  "--theme-bg",
  "--theme-bg-image",
  "--theme-fg",
  "--theme-sidebar-bg",
  "--theme-elevated-bg",
  "--theme-border",
  "--theme-surface-shadow",
  "--theme-skeleton-a",
  "--theme-skeleton-b",
  "--theme-dialog-backdrop",
  "--shadow-soft",
] as const;

export function createAppearanceBootstrapConfig(): AppearanceBootstrapConfig {
  return {
    storageKey: appearancePreferenceStorageKey,
    defaultPreference: defaultAppearancePreference,
    validPreferenceValues: {
      themeMode: [...themeModes],
      colorScheme: [...colorSchemes],
      accentColor: [...accentColors],
      fontFamily: [...appearanceFontFamilies],
      fontScale: [...fontScales],
    },
    accentColorByScheme: { ...recommendedAccentColors },
    firstPaintTokens: Object.fromEntries(
      colorSchemes.map((colorScheme) => [
        colorScheme,
        Object.fromEntries(
          (["light", "dark"] as const).map((resolvedTheme) => [
            resolvedTheme,
            selectFirstPaintTokens(
              createAppearanceTokens({ ...defaultAppearancePreference, colorScheme }, resolvedTheme).cssVariables,
            ),
          ]),
        ),
      ]),
    ) as AppearanceBootstrapConfig["firstPaintTokens"],
  };
}

function selectFirstPaintTokens(cssVariables: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    firstPaintCssVariableNames.map((name) => [name, cssVariables[name]]).filter(([, value]) => value !== undefined),
  );
}

export function createAppearanceBootstrapScript(): string {
  const config = createAppearanceBootstrapConfig();
  const serializedConfig = {
    ...config,
    firstPaintCssVariableNames: [...firstPaintCssVariableNames],
    firstPaintTokens: Object.fromEntries(
      colorSchemes.map((colorScheme) => [
        colorScheme,
        Object.fromEntries(
          (["light", "dark"] as const).map((resolvedTheme) => [
            resolvedTheme,
            firstPaintCssVariableNames.map((name) => config.firstPaintTokens[colorScheme][resolvedTheme][name]),
          ]),
        ),
      ]),
    ),
  };
  return `(() => {
  const config = ${JSON.stringify(serializedConfig)};
  const root = document.documentElement;
  const normalize = (raw) => {
    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }
    const normalized = Object.fromEntries(
      Object.entries(config.defaultPreference).map(([name, value]) => {
        const candidate = parsed[name];
        return [name, config.validPreferenceValues[name].includes(candidate) ? candidate : value];
      }),
    );
    normalized.accentColor = config.accentColorByScheme[normalized.colorScheme] ?? config.defaultPreference.accentColor;
    return normalized;
  };
  let preference = config.defaultPreference;
  try {
    preference = normalize(window.localStorage.getItem(config.storageKey));
  } catch {
    preference = config.defaultPreference;
  }
  const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const theme = preference.themeMode === "system" ? systemTheme : preference.themeMode;
  const firstPaintTokens = config.firstPaintTokens[preference.colorScheme]?.[theme] ?? [];
  config.firstPaintCssVariableNames.forEach((name, index) => {
    const value = firstPaintTokens[index];
    if (value) root.style.setProperty(name, value);
  });
  root.dataset.theme = theme;
  root.dataset.themePreference = preference.themeMode;
  root.dataset.colorScheme = preference.colorScheme;
  root.dataset.accentColor = preference.accentColor;
  root.dataset.fontFamily = preference.fontFamily;
  root.dataset.fontScale = preference.fontScale;
  root.style.colorScheme = theme;
})();`;
}
