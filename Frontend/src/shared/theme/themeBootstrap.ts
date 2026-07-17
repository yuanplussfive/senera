import {
  accentColors,
  appearanceFontFamilies,
  appearancePreferenceStorageKey,
  colorSchemes,
  defaultAppearancePreference,
  fontScales,
  themeModes,
  type AppearancePreference,
} from "./themeModel";

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
  legacyPreferenceValues: {
    colorScheme: Record<string, string>;
  };
}

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
    legacyPreferenceValues: {
      colorScheme: {
        monochrome: "mono",
        nordic: "classic",
        sepia: "honey",
      },
    },
  };
}

export function createAppearanceBootstrapScript(): string {
  const config = createAppearanceBootstrapConfig();
  return `(() => {
  const config = ${JSON.stringify(config)};
  const root = document.documentElement;
  const normalize = (raw) => {
    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }
    return Object.fromEntries(
      Object.entries(config.defaultPreference).map(([name, value]) => {
        const candidate = config.legacyPreferenceValues[name]?.[parsed[name]] ?? parsed[name];
        return [name, config.validPreferenceValues[name].includes(candidate) ? candidate : value];
      }),
    );
  };
  let preference = config.defaultPreference;
  try {
    preference = normalize(window.localStorage.getItem(config.storageKey));
  } catch {
    preference = config.defaultPreference;
  }
  const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const theme = preference.themeMode === "system" ? systemTheme : preference.themeMode;
  root.dataset.theme = theme;
  root.dataset.themePreference = preference.themeMode;
  root.dataset.colorScheme = preference.colorScheme;
  root.dataset.accentColor = preference.accentColor;
  root.dataset.fontFamily = preference.fontFamily;
  root.dataset.fontScale = preference.fontScale;
  root.style.colorScheme = theme;
})();`;
}
