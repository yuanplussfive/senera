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
      Object.entries(config.defaultPreference).map(([name, value]) => [
        name,
        config.validPreferenceValues[name].includes(parsed[name]) ? parsed[name] : value,
      ]),
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
