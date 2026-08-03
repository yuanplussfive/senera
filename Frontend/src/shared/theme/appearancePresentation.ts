import {
  defaultAppearancePreference,
  type AccentColor,
  type AppearanceFontFamily,
  type AppearancePreference,
  type ColorScheme,
  type FontScale,
  type ThemeMode,
} from "./themeModel";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
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
  get system() {
    return frontendMessage("appearance.themeMode.system");
  },
  get light() {
    return frontendMessage("appearance.themeMode.light");
  },
  get dark() {
    return frontendMessage("appearance.themeMode.dark");
  },
} as const satisfies Record<ThemeMode, string>;

export const colorSchemeLabels = {
  get senera() {
    return frontendMessage("appearance.scheme.senera");
  },
  get classic() {
    return frontendMessage("appearance.scheme.classic");
  },
  get mono() {
    return frontendMessage("appearance.scheme.mono");
  },
  get forest() {
    return frontendMessage("appearance.scheme.forest");
  },
  get sakura() {
    return frontendMessage("appearance.scheme.sakura");
  },
  get ocean() {
    return frontendMessage("appearance.scheme.ocean");
  },
  get lavender() {
    return frontendMessage("appearance.scheme.lavender");
  },
  get matcha() {
    return frontendMessage("appearance.scheme.matcha");
  },
  get honey() {
    return frontendMessage("appearance.scheme.honey");
  },
  get celadon() {
    return frontendMessage("appearance.scheme.celadon");
  },
} as const satisfies Record<ColorScheme, string>;

export const accentColorLabels = {
  get terra() {
    return frontendMessage("appearance.accent.terra");
  },
  get sky() {
    return frontendMessage("appearance.accent.sky");
  },
  get moss() {
    return frontendMessage("appearance.accent.moss");
  },
  get violet() {
    return frontendMessage("appearance.accent.violet");
  },
  get rose() {
    return frontendMessage("appearance.accent.rose");
  },
  get apricot() {
    return frontendMessage("appearance.accent.apricot");
  },
  get jade() {
    return frontendMessage("appearance.accent.jade");
  },
} as const satisfies Record<AccentColor, string>;

export const fontFamilyLabels = {
  get brand() {
    return frontendMessage("appearance.fontFamily.brand");
  },
  get system() {
    return frontendMessage("appearance.fontFamily.system");
  },
} as const satisfies Record<AppearanceFontFamily, string>;

export const fontScaleLabels = {
  get compact() {
    return frontendMessage("appearance.fontScale.compact");
  },
  get standard() {
    return frontendMessage("appearance.fontScale.standard");
  },
  get comfortable() {
    return frontendMessage("appearance.fontScale.comfortable");
  },
  get large() {
    return frontendMessage("appearance.fontScale.large");
  },
} as const satisfies Record<FontScale, string>;

const appearanceFieldLabels = {
  get themeMode() {
    return frontendMessage("appearance.control.theme");
  },
  get colorScheme() {
    return frontendMessage("appearance.control.colorScheme");
  },
  get accentColor() {
    return frontendMessage("appearance.control.accent");
  },
  get fontFamily() {
    return frontendMessage("appearance.control.font");
  },
  get fontScale() {
    return frontendMessage("appearance.control.fontScale");
  },
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
  return frontendMessage(colorSchemeStories[value] as FrontendMessageKey);
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
