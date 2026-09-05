import { accentTokens, paletteTokens, recommendedAccentColors } from "./themeData";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type ColorScheme =
  "senera" | "classic" | "mono" | "forest" | "sakura" | "ocean" | "lavender" | "matcha" | "honey" | "celadon";
export type AccentColor = "terra" | "sky" | "moss" | "violet" | "rose" | "apricot" | "jade";
export type AppearanceFontFamily = "brand" | "fresh" | "system";
export type FontScale = "compact" | "standard" | "comfortable" | "large";

/** Continuous reading scale range. The named FontScale values remain the legacy anchors. */
export const fontScaleRange = { min: 0.9, max: 1.12, step: 0.001 } as const;

export interface AppearancePreference {
  themeMode: ThemeMode;
  colorScheme: ColorScheme;
  accentColor: AccentColor;
  /** Optional user-selected accent. Presets continue to use accentColor. */
  customAccentColor?: string;
  fontFamily: AppearanceFontFamily;
  fontScale: FontScale;
  /** Optional continuous scale written by the slider; omitted for legacy presets. */
  fontScaleValue?: number;
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
export const appearanceFontFamilies = ["brand", "fresh", "system"] as const satisfies readonly AppearanceFontFamily[];
export const fontScales = ["compact", "standard", "comfortable", "large"] as const satisfies readonly FontScale[];

const emojiFontFamilyStack = '"Segoe UI Emoji", "Noto Color Emoji", emoji';

export const appearanceFontFamilyStacks: Record<AppearanceFontFamily, string> = {
  brand: `"Geist", "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", "Segoe UI Variable", "Segoe UI", ${emojiFontFamilyStack}, ui-sans-serif, system-ui, sans-serif`,
  fresh: `"Nunito Sans Variable", "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", "Segoe UI Variable", "Segoe UI", ${emojiFontFamilyStack}, ui-sans-serif, system-ui, sans-serif`,
  system: `-apple-system, "Segoe UI Variable", "Segoe UI", ${emojiFontFamilyStack}, "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", ui-sans-serif, system-ui, sans-serif`,
};

const themeMonoFontFamily = `"JetBrains Mono", "Cascadia Mono", ${emojiFontFamilyStack}, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

export const fontScaleValues: Record<FontScale, number> = {
  compact: 0.96,
  standard: 1,
  comfortable: 1.04,
  large: 1.08,
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
  "--senera-signal-violet": "rgb(var(--color-accent-500))",
  "--senera-signal-gold": "rgb(var(--color-umber-500))",
  "--theme-code-output-bg": "rgb(var(--color-ink-950))",
  "--theme-code-output-fg": "rgb(var(--color-paper-50))",
  "--theme-code-output-border": "rgb(var(--color-ink-200) / 0.24)",
  "--theme-code-output-muted": "rgb(var(--color-paper-300) / 0.72)",
  "--theme-code-editor-font-size": "calc(13px * var(--theme-font-scale-safe))",
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
    "--theme-tooltip-bg": "rgb(var(--color-ink-900))",
    "--theme-tooltip-fg": "rgb(var(--color-paper-50))",
    "--theme-tooltip-border": "rgb(var(--color-paper-50) / 0.18)",
    "--theme-tooltip-shadow": "var(--shadow-soft)",
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
    "--theme-tooltip-bg": "rgb(var(--color-paper-50))",
    "--theme-tooltip-fg": "rgb(var(--color-ink-950))",
    "--theme-tooltip-border": "rgb(var(--color-ink-950) / 0.16)",
    "--theme-tooltip-shadow": "var(--shadow-soft)",
    "--theme-overlay-shadow": "0 30px 76px -22px rgb(0 0 0 / 0.82), 0 12px 32px -18px rgb(0 0 0 / 0.68)",
    "--theme-dialog-backdrop": "rgb(0 0 0 / 0.68)",
    "--theme-sheet-backdrop": "rgb(0 0 0 / 0.58)",
  },
};

export function normalizeAppearancePreference(value: unknown): AppearancePreference {
  const source = value && typeof value === "object" ? (value as Partial<AppearancePreference>) : {};
  const colorScheme = isColorScheme(source.colorScheme) ? source.colorScheme : defaultAppearancePreference.colorScheme;
  const customAccentColor = normalizeCustomAccentColor(source.customAccentColor);
  const fontScaleValue = normalizeFontScaleValue(source.fontScaleValue);
  return {
    themeMode: isThemeMode(source.themeMode) ? source.themeMode : defaultAppearancePreference.themeMode,
    colorScheme,
    accentColor: recommendedAccentColors[colorScheme],
    fontFamily: isAppearanceFontFamily(source.fontFamily) ? source.fontFamily : defaultAppearancePreference.fontFamily,
    fontScale: isFontScale(source.fontScale) ? source.fontScale : defaultAppearancePreference.fontScale,
    ...(fontScaleValue === undefined ? {} : { fontScaleValue }),
    ...(customAccentColor ? { customAccentColor } : {}),
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
      ...(preference.customAccentColor ? createCustomAccentTokens(preference.customAccentColor, resolvedTheme) : {}),
      ...visualRoleTokens[resolvedTheme],
      ...semanticColorRoleTokens[resolvedTheme],
      "--theme-font-scale": String(readFontScaleValue(preference)),
      "--theme-ui-font-family": appearanceFontFamilyStacks[preference.fontFamily],
      "--theme-reading-font-family": appearanceFontFamilyStacks[preference.fontFamily],
      "--theme-mono-font-family": themeMonoFontFamily,
      "--theme-emoji-font-family": emojiFontFamilyStack,
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
    left.preference.customAccentColor === right.preference.customAccentColor &&
    left.preference.fontFamily === right.preference.fontFamily &&
    left.preference.fontScale === right.preference.fontScale &&
    readFontScaleValue(left.preference) === readFontScaleValue(right.preference)
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
  return appearanceFontFamilies.includes(value as AppearanceFontFamily);
}

function isFontScale(value: unknown): value is FontScale {
  return value === "compact" || value === "standard" || value === "comfortable" || value === "large";
}

export function readFontScaleValue(preference: Pick<AppearancePreference, "fontScale" | "fontScaleValue">): number {
  return preference.fontScaleValue ?? fontScaleValues[preference.fontScale];
}

export function readFontScaleAnchor(value: number): FontScale {
  const nearest = (Object.entries(fontScaleValues) as Array<[FontScale, number]>).reduce(
    (best, current) => (Math.abs(current[1] - value) < Math.abs(best[1] - value) ? current : best),
    ["standard", fontScaleValues.standard] as [FontScale, number],
  );
  return nearest[0];
}

function normalizeFontScaleValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const clamped = Math.min(fontScaleRange.max, Math.max(fontScaleRange.min, value));
  return Number((Math.round(clamped / fontScaleRange.step) * fontScaleRange.step).toFixed(3));
}

function normalizeCustomAccentColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(compact)) {
    return `#${compact
      .split("")
      .map((channel) => `${channel}${channel}`)
      .join("")
      .toLowerCase()}`;
  }
  if (/^[\da-f]{6}$/i.test(compact)) return `#${compact.toLowerCase()}`;
  return undefined;
}

function createCustomAccentTokens(value: string, resolvedTheme: ResolvedTheme): Record<string, string> {
  const base = readHexRgb(value);
  if (!base) return {};

  const shades =
    resolvedTheme === "dark"
      ? {
          50: blendRgb(base, [0, 0, 0], 0.58),
          100: blendRgb(base, [0, 0, 0], 0.44),
          200: blendRgb(base, [0, 0, 0], 0.26),
          300: blendRgb(base, [255, 255, 255], 0.02),
          400: blendRgb(base, [255, 255, 255], 0.1),
          500: blendRgb(base, [255, 255, 255], 0.18),
          600: blendRgb(base, [255, 255, 255], 0.3),
          700: blendRgb(base, [255, 255, 255], 0.44),
        }
      : {
          50: blendRgb(base, [255, 255, 255], 0.94),
          100: blendRgb(base, [255, 255, 255], 0.84),
          200: blendRgb(base, [255, 255, 255], 0.66),
          300: blendRgb(base, [255, 255, 255], 0.42),
          400: blendRgb(base, [255, 255, 255], 0.18),
          500: base.join(" "),
          600: blendRgb(base, [0, 0, 0], 0.12),
          700: blendRgb(base, [0, 0, 0], 0.28),
        };
  const solid = readRgbTriplet(shades[500]) ?? base;
  const contrast = relativeLuminance(solid) > 0.56 ? "24 25 28" : "255 255 255";
  return {
    ...Object.fromEntries(Object.entries(shades).map(([step, channels]) => [`--color-accent-${step}`, channels])),
    "--color-accent-contrast": contrast,
  };
}

function readHexRgb(value: string): [number, number, number] | undefined {
  const normalized = normalizeCustomAccentColor(value);
  if (!normalized) return undefined;
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function blendRgb(
  base: readonly [number, number, number],
  target: readonly [number, number, number],
  amount: number,
): string {
  return base.map((channel, index) => Math.round(channel + (target[index] - channel) * amount)).join(" ");
}

function readRgbTriplet(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const channels = value.split(" ").map(Number);
  return channels.length === 3 && channels.every(Number.isFinite)
    ? [channels[0]!, channels[1]!, channels[2]!]
    : undefined;
}

function relativeLuminance([red, green, blue]: readonly [number, number, number]): number {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}
