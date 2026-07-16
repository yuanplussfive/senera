import {
  defaultAppearancePreference,
  type AccentColor,
  type AppearanceFontFamily,
  type AppearancePreference,
  type ColorScheme,
  type FontScale,
  type ThemeMode,
} from "./themeModel";

export type AppearancePreferenceId = keyof AppearancePreference;

export interface AppearanceSummaryItem {
  id: AppearancePreferenceId;
  label: string;
  value: string;
}

export interface AppearanceTokenRow {
  label: string;
  value: string;
}

export const themeModeLabels = {
  system: "系统",
  light: "浅色",
  dark: "深色",
} as const satisfies Record<ThemeMode, string>;

export const colorSchemeLabels = {
  senera: "Senera 暖纸",
  monochrome: "纯粹黑白",
  nordic: "北欧冷调",
  sepia: "暖咖复古",
  lavender: "丁香暮光",
  ocean: "深海幽蓝",
} as const satisfies Record<ColorScheme, string>;

export const accentColorLabels = {
  terra: "陶土",
  violet: "紫藤",
  moss: "苔绿",
  sky: "天蓝",
} as const satisfies Record<AccentColor, string>;

export const fontFamilyLabels = {
  brand: "品牌",
  system: "系统",
} as const satisfies Record<AppearanceFontFamily, string>;

export const fontScaleLabels = {
  compact: "紧凑",
  standard: "标准",
  comfortable: "舒展",
  large: "大字",
} as const satisfies Record<FontScale, string>;

const appearanceFieldLabels = {
  themeMode: "主题",
  colorScheme: "配色",
  accentColor: "强调色",
  fontFamily: "字体",
  fontScale: "字号",
} as const satisfies Record<AppearancePreferenceId, string>;

export function createAppearanceSummary(preference: AppearancePreference): AppearanceSummaryItem[] {
  return [
    {
      id: "themeMode",
      label: appearanceFieldLabels.themeMode,
      value: themeModeLabels[preference.themeMode],
    },
    {
      id: "colorScheme",
      label: appearanceFieldLabels.colorScheme,
      value: colorSchemeLabels[preference.colorScheme],
    },
    {
      id: "accentColor",
      label: appearanceFieldLabels.accentColor,
      value: accentColorLabels[preference.accentColor],
    },
    {
      id: "fontFamily",
      label: appearanceFieldLabels.fontFamily,
      value: fontFamilyLabels[preference.fontFamily],
    },
    {
      id: "fontScale",
      label: appearanceFieldLabels.fontScale,
      value: fontScaleLabels[preference.fontScale],
    },
  ];
}

export function isDefaultAppearancePreference(preference: AppearancePreference): boolean {
  return (
    preference.themeMode === defaultAppearancePreference.themeMode &&
    preference.colorScheme === defaultAppearancePreference.colorScheme &&
    preference.accentColor === defaultAppearancePreference.accentColor &&
    preference.fontFamily === defaultAppearancePreference.fontFamily &&
    preference.fontScale === defaultAppearancePreference.fontScale
  );
}

export function readAppearanceTokenRows(preference: AppearancePreference): AppearanceTokenRow[] {
  return [
    { label: "data-theme-preference", value: preference.themeMode },
    { label: "data-color-scheme", value: preference.colorScheme },
    { label: "data-accent-color", value: preference.accentColor },
    { label: "data-font-family", value: preference.fontFamily },
    { label: "data-font-scale", value: preference.fontScale },
  ];
}

export function readSchemeSwatch(value: ColorScheme): string {
  if (value === "monochrome") return "#f5f5f5";
  if (value === "nordic") return "#eef2f6";
  if (value === "sepia") return "#e8ddcc";
  if (value === "lavender") return "#f0eef5";
  if (value === "ocean") return "#f0f8ff";
  return "#f8f8f6";
}

export function readAccentSwatch(value: AccentColor): string {
  if (value === "violet") return "#7e67c2";
  if (value === "moss") return "#5a7d4c";
  if (value === "sky") return "#3b82f6";
  return "#b45d40";
}
