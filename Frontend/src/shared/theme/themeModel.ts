import { accentTokens, paletteTokens, recommendedAccentColors } from "./themeData";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type ColorScheme =
  "senera" | "classic" | "mono" | "forest" | "sakura" | "ocean" | "lavender" | "matcha" | "honey" | "celadon";
export type AccentColor = "terra" | "sky" | "moss" | "violet" | "rose" | "apricot" | "jade";
export type AppearanceFontFamily = "brand" | "system";
export type FontScale = "compact" | "standard" | "comfortable" | "large";

export interface AppearancePreference {
  themeMode: ThemeMode;
  colorScheme: ColorScheme;
  accentColor: AccentColor;
  fontFamily: AppearanceFontFamily;
  fontScale: FontScale;
}

export type AppearancePreferenceUpdate = Partial<Omit<AppearancePreference, "accentColor">>;

export interface AppearanceSnapshot {
  preference: AppearancePreference;
  resolvedTheme: ResolvedTheme;
  systemTheme: ResolvedTheme;
  tokens: AppearanceTokens;
}

export interface AppearanceTokens {
  dataset: {
    theme: ResolvedTheme;
    themePreference: ThemeMode;
    colorScheme: ColorScheme;
    accentColor: AccentColor;
    fontFamily: AppearanceFontFamily;
    fontScale: FontScale;
  };
  cssVariables: Record<string, string>;
}

export const appearancePreferenceStorageKey = "senera.appearancePreference";

export const defaultAppearancePreference = {
  themeMode: "system",
  colorScheme: "senera",
  accentColor: "terra",
  fontFamily: "brand",
  fontScale: "standard",
} as const satisfies AppearancePreference;

export const themeModes = ["system", "light", "dark"] as const satisfies readonly ThemeMode[];
export const colorSchemes = [
  "senera",
  "classic",
  "mono",
  "forest",
  "sakura",
  "ocean",
  "lavender",
  "matcha",
  "honey",
  "celadon",
] as const satisfies readonly ColorScheme[];
export const accentColors = [
  "terra",
  "sky",
  "moss",
  "violet",
  "rose",
  "apricot",
  "jade",
] as const satisfies readonly AccentColor[];
export const appearanceFontFamilies = ["brand", "system"] as const satisfies readonly AppearanceFontFamily[];
export const fontScales = ["compact", "standard", "comfortable", "large"] as const satisfies readonly FontScale[];

const fontScaleValues: Record<FontScale, string> = {
  compact: "0.96",
  standard: "1",
  comfortable: "1.04",
  large: "1.08",
};

const semanticColorAliases = {
  "--color-terra-50": "var(--color-accent-50)",
  "--color-terra-100": "var(--color-accent-100)",
  "--color-terra-200": "var(--color-accent-200)",
  "--color-terra-300": "var(--color-accent-300)",
  "--color-terra-400": "var(--color-accent-400)",
  "--color-terra-500": "var(--color-accent-500)",
  "--color-terra-600": "var(--color-accent-600)",
  "--color-terra-700": "var(--color-accent-700)",
  "--surface-canvas": "var(--theme-bg)",
  "--surface-sidebar": "var(--theme-sidebar-bg)",
  "--surface-panel": "rgb(var(--color-paper-50))",
  "--surface-raised": "var(--theme-elevated-bg)",
  "--surface-subtle": "rgb(var(--color-paper-100))",
  "--surface-muted": "rgb(var(--color-paper-200))",
  "--content-strong": "rgb(var(--color-ink-950))",
  "--content-primary": "rgb(var(--color-ink-900))",
  "--content-secondary": "rgb(var(--color-ink-650))",
  "--content-muted": "rgb(var(--color-ink-400))",
  "--content-disabled": "rgb(var(--color-ink-350))",
  "--content-inverse": "rgb(var(--color-paper-50))",
  "--line-subtle": "rgb(var(--color-ink-200) / 0.70)",
  "--line-default": "var(--theme-border)",
  "--line-strong": "rgb(var(--color-ink-300))",
  "--accent-solid": "rgb(var(--color-accent-500))",
  "--accent-solid-hover": "rgb(var(--color-accent-600))",
  "--accent-solid-pressed": "rgb(var(--color-accent-700))",
  "--accent-content": "rgb(var(--color-accent-700))",
  "--accent-on-solid": "rgb(var(--color-accent-contrast))",
  "--accent-shadow":
    "0 1px 2px rgb(var(--color-accent-700) / 0.24), 0 7px 16px -10px rgb(var(--color-accent-700) / 0.58)",
} as const;

const semanticColorRoleTokens: Record<ResolvedTheme, Record<string, string>> = {
  light: {
    ...semanticColorAliases,
    "--accent-content-hover": "rgb(var(--color-accent-600))",
    "--accent-surface": "rgb(var(--color-accent-50))",
    "--accent-surface-hover": "rgb(var(--color-accent-100))",
    "--accent-border": "rgb(var(--color-accent-200))",
    "--accent-border-strong": "rgb(var(--color-accent-300))",
    "--accent-focus-ring": "rgb(var(--color-accent-200) / 0.70)",
    "--surface-hover": "rgb(var(--color-ink-900) / 0.05)",
    "--theme-accent-soft": "var(--accent-surface)",
    "--theme-hover-wash": "var(--surface-hover)",
    "--theme-selection-bg": "rgb(var(--color-accent-500) / 0.18)",
    "--theme-selection-fg": "var(--content-primary)",
    "--theme-complete-highlight": "rgb(var(--color-accent-500) / 0.08)",
  },
  dark: {
    ...semanticColorAliases,
    "--accent-content-hover": "rgb(var(--color-accent-600))",
    "--accent-surface": "rgb(var(--color-accent-500) / 0.14)",
    "--accent-surface-hover": "rgb(var(--color-accent-500) / 0.22)",
    "--accent-border": "rgb(var(--color-accent-400) / 0.40)",
    "--accent-border-strong": "rgb(var(--color-accent-400) / 0.68)",
    "--accent-focus-ring": "rgb(var(--color-accent-400) / 0.58)",
    "--surface-hover": "rgb(var(--color-ink-900) / 0.08)",
    "--theme-accent-soft": "var(--accent-surface)",
    "--theme-hover-wash": "var(--surface-hover)",
    "--theme-selection-bg": "rgb(var(--color-accent-500) / 0.26)",
    "--theme-selection-fg": "var(--content-strong)",
    "--theme-complete-highlight": "rgb(var(--color-accent-500) / 0.13)",
  },
};

const sharedVisualRoleTokens = {
  "--theme-config-nav-bg": "rgb(var(--color-paper-100))",
  "--theme-config-list-bg": "rgb(var(--color-paper-50))",
  "--theme-config-header-bg": "rgb(var(--color-paper-200))",
  "--theme-config-toolbar-bg": "rgb(var(--color-paper-100))",
  "--theme-config-stage-bg": "rgb(var(--color-paper-100))",
  "--theme-config-panel-bg": "rgb(var(--color-paper-50))",
  "--theme-config-editor-loading-bg": "rgb(var(--color-paper-50))",
} as const;

const visualRoleTokens: Record<ResolvedTheme, Record<string, string>> = {
  light: {
    ...sharedVisualRoleTokens,
    "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
    "--theme-chat-user-fg": "rgb(var(--color-ink-900))",
    "--theme-chat-user-hover-bg": "rgb(var(--color-paper-300) / 0.80)",
    "--theme-chat-user-font-size": "14.5px",
    "--theme-chat-user-line-height": "1.55",
    "--theme-chat-assistant-font-size": "15px",
    "--theme-chat-assistant-line-height": "1.75",
    "--theme-chat-composer-bg": "rgb(var(--color-paper-100) / 0.80)",
    "--theme-chat-composer-focus-bg": "rgb(var(--color-paper-50))",
    "--theme-session-active-bg": "var(--accent-surface)",
    "--theme-overlay-shadow": "0 30px 72px -26px rgb(24 25 28 / 0.42), 0 10px 28px -16px rgb(24 25 28 / 0.24)",
    "--theme-dialog-backdrop": "rgb(24 25 28 / 0.52)",
    "--theme-sheet-backdrop": "rgb(24 25 28 / 0.44)",
  },
  dark: {
    ...sharedVisualRoleTokens,
    "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
    "--theme-chat-user-fg": "rgb(var(--color-ink-950))",
    "--theme-chat-user-hover-bg": "rgb(var(--color-paper-300))",
    "--theme-chat-user-font-size": "14.5px",
    "--theme-chat-user-line-height": "1.55",
    "--theme-chat-assistant-font-size": "15px",
    "--theme-chat-assistant-line-height": "1.75",
    "--theme-chat-composer-bg": "rgb(var(--color-paper-50) / 0.76)",
    "--theme-chat-composer-focus-bg": "rgb(var(--color-paper-50) / 0.92)",
    "--theme-session-active-bg": "var(--accent-surface)",
    "--theme-overlay-shadow": "0 30px 76px -22px rgb(0 0 0 / 0.82), 0 12px 32px -18px rgb(0 0 0 / 0.68)",
    "--theme-dialog-backdrop": "rgb(0 0 0 / 0.68)",
    "--theme-sheet-backdrop": "rgb(0 0 0 / 0.58)",
  },
};

export function normalizeAppearancePreference(value: unknown): AppearancePreference {
  const source = value && typeof value === "object" ? (value as Partial<AppearancePreference>) : {};
  const colorScheme = isColorScheme(source.colorScheme)
    ? source.colorScheme
    : defaultAppearancePreference.colorScheme;
  return {
    themeMode: isThemeMode(source.themeMode) ? source.themeMode : defaultAppearancePreference.themeMode,
    colorScheme,
    accentColor: recommendedAccentColors[colorScheme],
    fontFamily: isAppearanceFontFamily(source.fontFamily) ? source.fontFamily : defaultAppearancePreference.fontFamily,
    fontScale: isFontScale(source.fontScale) ? source.fontScale : defaultAppearancePreference.fontScale,
  };
}

export function resolveThemeMode(themeMode: ThemeMode, systemTheme: ResolvedTheme): ResolvedTheme {
  return themeMode === "system" ? systemTheme : themeMode;
}

export function readSystemTheme(matchMedia: Pick<Window, "matchMedia">["matchMedia"] | undefined): ResolvedTheme {
  if (!matchMedia) return "light";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function createAppearanceSnapshot({
  preference,
  systemTheme,
}: {
  preference: AppearancePreference;
  systemTheme: ResolvedTheme;
}): AppearanceSnapshot {
  const normalizedPreference = normalizeAppearancePreference(preference);
  const resolvedTheme = resolveThemeMode(normalizedPreference.themeMode, systemTheme);
  return {
    preference: normalizedPreference,
    resolvedTheme,
    systemTheme,
    tokens: createAppearanceTokens(normalizedPreference, resolvedTheme),
  };
}

export function createAppearanceTokens(
  preference: AppearancePreference,
  resolvedTheme: ResolvedTheme,
): AppearanceTokens {
  return {
    dataset: {
      theme: resolvedTheme,
      themePreference: preference.themeMode,
      colorScheme: preference.colorScheme,
      accentColor: preference.accentColor,
      fontFamily: preference.fontFamily,
      fontScale: preference.fontScale,
    },
    cssVariables: {
      ...paletteTokens[preference.colorScheme][resolvedTheme],
      ...accentTokens[preference.accentColor][resolvedTheme],
      ...visualRoleTokens[resolvedTheme],
      ...semanticColorRoleTokens[resolvedTheme],
      "--theme-font-scale": fontScaleValues[preference.fontScale],
      "--theme-ui-font-family":
        preference.fontFamily === "brand"
          ? '"Geist", "Segoe UI Variable", "Segoe UI", ui-sans-serif, system-ui, sans-serif'
          : "ui-sans-serif, system-ui, sans-serif",
      "--theme-display-font-family":
        preference.fontFamily === "brand"
          ? '"Fraunces", ui-serif, Georgia, serif'
          : "ui-sans-serif, system-ui, sans-serif",
      "--scrollbar-size": "8px",
      "--scrollbar-track": "transparent",
      "--code-source-max-height": "500px",
    },
  };
}

export function areAppearanceSnapshotsEqual(left: AppearanceSnapshot, right: AppearanceSnapshot): boolean {
  return (
    left.resolvedTheme === right.resolvedTheme &&
    left.systemTheme === right.systemTheme &&
    left.preference.themeMode === right.preference.themeMode &&
    left.preference.colorScheme === right.preference.colorScheme &&
    left.preference.accentColor === right.preference.accentColor &&
    left.preference.fontFamily === right.preference.fontFamily &&
    left.preference.fontScale === right.preference.fontScale
  );
}

export function readResolvedAppearance({
  readStorageValue,
  readSystemTheme: readSystemThemeValue,
}: {
  readStorageValue: (key: string) => string | null;
  readSystemTheme: () => ResolvedTheme;
}): AppearanceSnapshot {
  return createAppearanceSnapshot({
    preference: readStoredAppearancePreference(readStorageValue),
    systemTheme: readSystemThemeValue(),
  });
}

export function readStoredAppearancePreference(readStorageValue: (key: string) => string | null): AppearancePreference {
  try {
    const raw = readStorageValue(appearancePreferenceStorageKey);
    if (!raw) return defaultAppearancePreference;
    return normalizeAppearancePreference(JSON.parse(raw));
  } catch {
    return defaultAppearancePreference;
  }
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === "string" && colorSchemes.includes(value as ColorScheme);
}

function isAppearanceFontFamily(value: unknown): value is AppearanceFontFamily {
  return value === "brand" || value === "system";
}

function isFontScale(value: unknown): value is FontScale {
  return value === "compact" || value === "standard" || value === "comfortable" || value === "large";
}
