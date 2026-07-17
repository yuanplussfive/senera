import {
  defaultAppearancePreference,
  type AccentColor,
  type AppearanceFontFamily,
  type AppearancePreference,
  type ColorScheme,
  type FontScale,
  type ThemeMode,
} from "./themeModel";
import { colorSchemeStories, colorSchemeSwatches, recommendedAccentColors } from "./themeData";

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
  senera: "暖纸",
  classic: "冷灰",
  mono: "墨灰",
  forest: "森绿",
  sakura: "樱粉",
  ocean: "雾蓝",
  lavender: "薰紫",
  matcha: "抹茶",
  honey: "蜜杏",
  celadon: "青瓷",
} as const satisfies Record<ColorScheme, string>;

export const accentColorLabels = {
  terra: "陶土",
  sky: "天蓝",
  moss: "苔绿",
  violet: "紫藤",
  rose: "蔷薇",
  apricot: "杏子",
  jade: "青玉",
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
  return toRgbColor(colorSchemeSwatches[value].paper[1] ?? colorSchemeSwatches[value].paper[0]);
}

export function readSchemeSwatchStrip(value: ColorScheme): string[] {
  const swatch = colorSchemeSwatches[value];
  return [...swatch.paper.slice(0, 3), ...swatch.ink.slice(0, 2)].map(toRgbColor);
}

export function readColorSchemeStory(value: ColorScheme): string {
  return colorSchemeStories[value];
}

export function readRecommendedAccent(value: ColorScheme): AccentColor {
  return recommendedAccentColors[value];
}

export function readAccentSwatch(value: AccentColor): string {
  const values: Record<AccentColor, string> = {
    terra: "180 93 64",
    sky: "59 130 246",
    moss: "90 125 76",
    violet: "107 83 177",
    rose: "176 92 101",
    apricot: "167 103 62",
    jade: "47 128 124",
  };
  return toRgbColor(values[value]);
}

function toRgbColor(value: string): string {
  return `rgb(${value})`;
}
