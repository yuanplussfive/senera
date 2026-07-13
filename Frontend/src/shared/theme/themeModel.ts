export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type ColorScheme = "senera" | "classic" | "mono" | "forest";
export type AccentColor = "terra" | "violet" | "moss" | "sky";
export type AppearanceFontFamily = "brand" | "system";
export type FontScale = "compact" | "standard" | "comfortable" | "large";

export interface AppearancePreference {
  themeMode: ThemeMode;
  colorScheme: ColorScheme;
  accentColor: AccentColor;
  fontFamily: AppearanceFontFamily;
  fontScale: FontScale;
}

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
export const colorSchemes = ["senera", "classic", "mono", "forest"] as const satisfies readonly ColorScheme[];
export const accentColors = ["terra", "violet", "moss", "sky"] as const satisfies readonly AccentColor[];
export const appearanceFontFamilies = ["brand", "system"] as const satisfies readonly AppearanceFontFamily[];
export const fontScales = ["compact", "standard", "comfortable", "large"] as const satisfies readonly FontScale[];

const fontScaleValues: Record<FontScale, string> = {
  compact: "0.96",
  standard: "1",
  comfortable: "1.04",
  large: "1.08",
};

const paletteTokens: Record<ColorScheme, Record<ResolvedTheme, Record<string, string>>> = {
  senera: {
    light: {
      "--color-paper-50": "255 255 255",
      "--color-paper-100": "248 248 246",
      "--color-paper-200": "239 238 235",
      "--color-paper-300": "224 223 219",
      "--color-paper-400": "199 197 189",
      "--color-ink-950": "33 30 24",
      "--color-ink-900": "43 40 32",
      "--color-ink-850": "50 47 39",
      "--color-ink-800": "63 58 49",
      "--color-ink-700": "81 76 64",
      "--color-ink-650": "98 93 80",
      "--color-ink-600": "106 101 88",
      "--color-ink-500": "115 112 95",
      "--color-ink-400": "150 145 127",
      "--color-ink-350": "170 165 146",
      "--color-ink-300": "186 181 166",
      "--color-ink-200": "224 223 219",
      "--color-ink-100": "234 233 229",
      "--color-ink-50": "244 244 241",
      "--color-moss-50": "240 243 235",
      "--color-moss-100": "219 226 203",
      "--color-moss-400": "125 152 102",
      "--color-moss-500": "90 125 76",
      "--color-moss-600": "69 98 57",
      "--color-umber-50": "247 240 228",
      "--color-umber-100": "234 220 197",
      "--color-umber-200": "210 186 141",
      "--color-umber-500": "138 106 63",
      "--color-umber-600": "112 86 50",
      "--color-brick-50": "254 246 238",
      "--color-brick-100": "253 232 215",
      "--color-brick-200": "250 201 164",
      "--color-brick-500": "217 119 6",
      "--color-brick-600": "180 83 9",
      "--color-brick-700": "146 64 14",
      "--theme-bg": "rgb(248 248 246)",
      "--theme-bg-image":
        "radial-gradient(circle at 0% 0%, rgb(194 105 74 / 0.018) 0, transparent 35%), radial-gradient(circle at 100% 100%, rgb(90 125 76 / 0.016) 0, transparent 35%)",
      "--theme-fg": "rgb(43 40 32)",
      "--theme-sidebar-bg": "rgb(244 244 241)",
      "--theme-elevated-bg": "rgb(255 255 255)",
      "--theme-border": "rgb(224 223 219)",
      "--theme-accent-soft": "rgb(241 220 207)",
      "--theme-surface-shadow": "0 1px 2px rgb(43 40 32 / 0.04), 0 12px 24px rgb(43 40 32 / 0.06)",
      "--theme-panel-glaze": "rgb(255 255 255 / 0.56)",
      "--theme-hover-wash": "rgb(43 40 32 / 0.055)",
      "--theme-selection-bg": "rgb(194 105 74 / 0.18)",
      "--theme-selection-fg": "rgb(43 40 32)",
      "--theme-skeleton-a": "rgb(43 40 32 / 0.035)",
      "--theme-skeleton-b": "rgb(43 40 32 / 0.09)",
      "--theme-complete-highlight": "rgb(194 105 74 / 0.08)",
      "--theme-code-editor-bg": "rgb(255 255 255)",
      "--theme-code-editor-fg": "rgb(var(--color-ink-850))",
      "--theme-code-editor-gutter-bg": "rgb(var(--color-paper-200) / 0.72)",
      "--theme-code-editor-gutter-border": "rgb(var(--color-ink-900) / 0.10)",
      "--theme-code-editor-gutter-fg": "rgb(var(--color-ink-900) / 0.42)",
      "--theme-code-editor-active-line-bg": "rgb(var(--color-terra-500) / 0.07)",
      "--theme-code-editor-active-gutter-bg": "rgb(var(--color-terra-500) / 0.09)",
      "--theme-code-editor-active-gutter-fg": "rgb(var(--color-terra-700))",
      "--theme-code-editor-selection-bg": "rgb(var(--color-terra-500) / 0.18)",
      "--theme-code-editor-caret": "rgb(var(--color-terra-500))",
      "--theme-code-token-keyword": "rgb(var(--color-terra-600))",
      "--theme-code-token-string": "rgb(var(--color-moss-600))",
      "--theme-code-token-property": "rgb(var(--color-umber-600))",
      "--theme-code-token-literal": "rgb(39 107 117)",
      "--theme-code-token-comment": "rgb(var(--color-ink-500))",
      "--theme-code-token-name": "rgb(var(--color-ink-800))",
      "--theme-code-token-punctuation": "rgb(var(--color-ink-500))",
      "--theme-code-token-invalid": "rgb(var(--color-brick-700))",
      "--theme-config-nav-bg": "rgb(244 244 241)",
      "--theme-config-list-bg": "rgb(248 248 246)",
      "--theme-config-header-bg": "rgb(239 238 235)",
      "--theme-config-toolbar-bg": "rgb(244 244 241)",
      "--theme-config-stage-bg": "rgb(248 248 246)",
      "--theme-config-panel-bg": "rgb(255 255 255)",
      "--theme-config-editor-loading-bg": "rgb(255 255 255)",
      "--theme-code-preview-bg": "rgb(255 255 255)",
      "--theme-code-loading-bg": "rgb(255 255 255 / 0.96)",
      "--theme-code-loading-border": "rgb(43 40 32 / 0.10)",
      "--theme-code-loading-shadow": "0 12px 32px rgb(43 40 32 / 0.13)",
      "--theme-code-line-rule": "rgb(224 223 219 / 0.7)",
      "--theme-code-line-number": "rgb(115 112 95 / 0.55)",
      "--theme-canvas-grid": "rgb(43 40 32 / 0.09)",
      "--theme-node-shadow": "0 1px 2px rgb(43 40 32 / 0.035), 0 4px 12px rgb(43 40 32 / 0.09)",
      "--theme-inset-highlight": "inset 0 1px 0 rgb(255 255 255 / 0.55)",
      "--shadow-bubble-user": "0 1px 1px rgb(43 40 32 / 0.04)",
      "--shadow-bubble-ai": "0 1px 0 rgb(43 40 32 / 0.05), 0 0 0 1px rgb(43 40 32 / 0.045)",
      "--shadow-panel": "0 0 0 1px rgb(43 40 32 / 0.055)",
      "--shadow-soft": "0 8px 24px -12px rgb(43 40 32 / 0.16)",
      "--shadow-avatar-cropper": "inset 0 0 0 1px rgb(255 255 255 / 0.18), 0 10px 30px rgb(43 40 32 / 0.14)",
      "--scrollbar-thumb": "rgb(43 40 32 / 0.15)",
      "--scrollbar-thumb-hover": "rgb(43 40 32 / 0.25)",
    },
    dark: {
      "--color-paper-50": "44 42 37",
      "--color-paper-100": "38 36 31",
      "--color-paper-200": "55 51 43",
      "--color-paper-300": "61 57 47",
      "--color-paper-400": "86 80 69",
      "--color-ink-950": "251 247 238",
      "--color-ink-900": "239 235 223",
      "--color-ink-850": "231 224 211",
      "--color-ink-800": "217 208 191",
      "--color-ink-700": "200 190 170",
      "--color-ink-650": "183 173 155",
      "--color-ink-600": "163 157 140",
      "--color-ink-500": "146 139 122",
      "--color-ink-400": "125 116 101",
      "--color-ink-350": "103 95 82",
      "--color-ink-300": "81 74 64",
      "--color-ink-200": "61 57 47",
      "--color-ink-100": "52 49 43",
      "--color-ink-50": "43 41 37",
      "--color-moss-50": "31 48 38",
      "--color-moss-100": "41 61 47",
      "--color-moss-400": "130 170 114",
      "--color-moss-500": "154 189 133",
      "--color-moss-600": "182 212 157",
      "--color-umber-50": "65 50 33",
      "--color-umber-100": "83 63 38",
      "--color-umber-200": "133 104 65",
      "--color-umber-500": "202 161 97",
      "--color-umber-600": "226 188 121",
      "--color-brick-50": "74 43 31",
      "--color-brick-100": "94 52 34",
      "--color-brick-200": "143 78 43",
      "--color-brick-500": "237 137 54",
      "--color-brick-600": "248 162 78",
      "--color-brick-700": "255 191 122",
      "--theme-bg": "rgb(38 36 31)",
      "--theme-bg-image":
        "radial-gradient(circle at 0% 0%, rgb(222 142 108 / 0.028) 0, transparent 34%), radial-gradient(circle at 100% 100%, rgb(163 157 140 / 0.02) 0, transparent 36%)",
      "--theme-fg": "rgb(239 235 223)",
      "--theme-sidebar-bg": "rgb(33 32 27)",
      "--theme-elevated-bg": "rgb(44 42 37)",
      "--theme-border": "rgb(61 57 47)",
      "--theme-accent-soft": "rgb(71 51 39)",
      "--theme-surface-shadow": "0 1px 2px rgb(0 0 0 / 0.30), 0 12px 24px rgb(0 0 0 / 0.40)",
      "--theme-panel-glaze": "rgb(255 246 224 / 0.045)",
      "--theme-hover-wash": "rgb(239 235 223 / 0.07)",
      "--theme-selection-bg": "rgb(222 142 108 / 0.28)",
      "--theme-selection-fg": "rgb(251 247 238)",
      "--theme-skeleton-a": "rgb(239 235 223 / 0.045)",
      "--theme-skeleton-b": "rgb(239 235 223 / 0.10)",
      "--theme-complete-highlight": "rgb(222 142 108 / 0.13)",
      "--theme-code-editor-bg": "rgb(var(--color-paper-100))",
      "--theme-code-editor-fg": "rgb(var(--color-ink-900))",
      "--theme-code-editor-gutter-bg": "rgb(var(--color-paper-50) / 0.66)",
      "--theme-code-editor-gutter-border": "rgb(var(--color-ink-900) / 0.10)",
      "--theme-code-editor-gutter-fg": "rgb(var(--color-ink-600) / 0.72)",
      "--theme-code-editor-active-line-bg": "rgb(var(--color-terra-500) / 0.11)",
      "--theme-code-editor-active-gutter-bg": "rgb(var(--color-terra-500) / 0.14)",
      "--theme-code-editor-active-gutter-fg": "rgb(var(--color-terra-700))",
      "--theme-code-editor-selection-bg": "rgb(var(--color-terra-500) / 0.26)",
      "--theme-code-editor-caret": "rgb(var(--color-terra-500))",
      "--theme-code-token-keyword": "rgb(var(--color-terra-600))",
      "--theme-code-token-string": "rgb(var(--color-moss-600))",
      "--theme-code-token-property": "rgb(var(--color-umber-600))",
      "--theme-code-token-literal": "rgb(103 205 218)",
      "--theme-code-token-comment": "rgb(var(--color-ink-500))",
      "--theme-code-token-name": "rgb(var(--color-ink-850))",
      "--theme-code-token-punctuation": "rgb(var(--color-ink-600))",
      "--theme-code-token-invalid": "rgb(var(--color-brick-600))",
      "--theme-config-nav-bg": "rgb(var(--color-paper-100))",
      "--theme-config-list-bg": "rgb(var(--color-paper-50))",
      "--theme-config-header-bg": "rgb(var(--color-paper-200))",
      "--theme-config-toolbar-bg": "rgb(var(--color-paper-50))",
      "--theme-config-stage-bg": "rgb(var(--color-paper-100))",
      "--theme-config-panel-bg": "rgb(var(--color-paper-50))",
      "--theme-config-editor-loading-bg": "rgb(var(--color-paper-100))",
      "--theme-code-preview-bg": "rgb(239 235 223)",
      "--theme-code-loading-bg": "rgb(47 44 38 / 0.96)",
      "--theme-code-loading-border": "rgb(239 235 223 / 0.10)",
      "--theme-code-loading-shadow": "0 16px 36px rgb(0 0 0 / 0.38)",
      "--theme-code-line-rule": "rgb(239 235 223 / 0.12)",
      "--theme-code-line-number": "rgb(163 157 140 / 0.62)",
      "--theme-canvas-grid": "rgb(239 235 223 / 0.07)",
      "--theme-node-shadow": "0 1px 2px rgb(0 0 0 / 0.28), 0 10px 26px -18px rgb(0 0 0 / 0.75)",
      "--theme-inset-highlight": "inset 0 1px 0 rgb(255 246 224 / 0.055)",
      "--shadow-bubble-user": "0 1px 1px rgb(0 0 0 / 0.22)",
      "--shadow-bubble-ai": "0 1px 2px rgb(0 0 0 / 0.28), 0 12px 28px -20px rgb(0 0 0 / 0.72)",
      "--shadow-panel": "0 0 0 1px rgb(239 235 223 / 0.075)",
      "--shadow-soft": "0 12px 32px -20px rgb(0 0 0 / 0.78)",
      "--shadow-avatar-cropper": "inset 0 0 0 1px rgb(255 246 224 / 0.10), 0 12px 34px rgb(0 0 0 / 0.42)",
      "--scrollbar-thumb": "rgb(239 235 223 / 0.18)",
      "--scrollbar-thumb-hover": "rgb(239 235 223 / 0.30)",
    },
  },
  mono: {
    light: {},
    dark: {},
  },
  classic: {
    light: {},
    dark: {},
  },
  forest: {
    light: {},
    dark: {},
  },
};

paletteTokens.mono.light = {
  ...paletteTokens.senera.light,
  "--color-paper-50": "255 255 255",
  "--color-paper-100": "245 245 245",
  "--color-paper-200": "229 229 229",
  "--color-paper-300": "212 212 212",
  "--color-paper-400": "163 163 163",
  "--color-ink-950": "10 10 10",
  "--color-ink-900": "23 23 23",
  "--color-ink-850": "38 38 38",
  "--color-ink-800": "64 64 64",
  "--color-ink-700": "82 82 82",
  "--color-ink-650": "97 97 97",
  "--color-ink-600": "115 115 115",
  "--color-ink-500": "115 115 115",
  "--color-ink-400": "140 140 140",
  "--color-ink-350": "163 163 163",
  "--color-ink-300": "190 190 190",
  "--color-ink-200": "212 212 212",
  "--color-ink-100": "229 229 229",
  "--color-ink-50": "245 245 245",
  "--theme-bg": "rgb(245 245 245)",
  "--theme-bg-image": "none",
  "--theme-fg": "rgb(23 23 23)",
  "--theme-sidebar-bg": "rgb(229 229 229)",
  "--theme-elevated-bg": "rgb(255 255 255)",
  "--theme-border": "rgb(212 212 212)",
  "--theme-accent-soft": "rgb(229 229 229)",
  "--theme-surface-shadow": "0 1px 2px rgb(0 0 0 / 0.04), 0 12px 24px rgb(0 0 0 / 0.08)",
  "--theme-hover-wash": "rgb(23 23 23 / 0.055)",
  "--theme-selection-bg": "rgb(23 23 23 / 0.16)",
  "--theme-selection-fg": "rgb(255 255 255)",
  "--theme-config-nav-bg": "rgb(229 229 229)",
  "--theme-config-list-bg": "rgb(245 245 245)",
  "--theme-config-header-bg": "rgb(229 229 229)",
  "--theme-config-toolbar-bg": "rgb(229 229 229)",
  "--theme-config-stage-bg": "rgb(245 245 245)",
  "--theme-config-panel-bg": "rgb(255 255 255)",
  "--scrollbar-thumb": "rgb(23 23 23 / 0.16)",
  "--scrollbar-thumb-hover": "rgb(23 23 23 / 0.28)",
};
paletteTokens.mono.dark = {
  ...paletteTokens.senera.dark,
  "--color-paper-50": "23 23 23",
  "--color-paper-100": "10 10 10",
  "--color-paper-200": "23 23 23",
  "--color-paper-300": "38 38 38",
  "--color-paper-400": "64 64 64",
  "--color-ink-950": "250 250 250",
  "--color-ink-900": "245 245 245",
  "--color-ink-850": "229 229 229",
  "--color-ink-800": "212 212 212",
  "--color-ink-700": "190 190 190",
  "--color-ink-650": "180 180 180",
  "--color-ink-600": "163 163 163",
  "--color-ink-500": "163 163 163",
  "--color-ink-400": "115 115 115",
  "--color-ink-350": "82 82 82",
  "--color-ink-300": "64 64 64",
  "--color-ink-200": "38 38 38",
  "--color-ink-100": "23 23 23",
  "--color-ink-50": "10 10 10",
  "--theme-bg": "rgb(10 10 10)",
  "--theme-bg-image": "none",
  "--theme-fg": "rgb(245 245 245)",
  "--theme-sidebar-bg": "rgb(0 0 0)",
  "--theme-elevated-bg": "rgb(23 23 23)",
  "--theme-border": "rgb(38 38 38)",
  "--theme-accent-soft": "rgb(38 38 38)",
  "--theme-surface-shadow": "0 1px 2px rgb(0 0 0 / 0.40), 0 12px 24px rgb(0 0 0 / 0.60)",
  "--theme-hover-wash": "rgb(245 245 245 / 0.075)",
  "--theme-selection-bg": "rgb(229 229 229 / 0.26)",
  "--theme-selection-fg": "rgb(10 10 10)",
  "--theme-config-nav-bg": "rgb(0 0 0)",
  "--theme-config-list-bg": "rgb(10 10 10)",
  "--theme-config-header-bg": "rgb(23 23 23)",
  "--theme-config-toolbar-bg": "rgb(23 23 23)",
  "--theme-config-stage-bg": "rgb(10 10 10)",
  "--theme-config-panel-bg": "rgb(23 23 23)",
  "--scrollbar-thumb": "rgb(245 245 245 / 0.18)",
  "--scrollbar-thumb-hover": "rgb(245 245 245 / 0.32)",
};
paletteTokens.classic.light = {
  ...paletteTokens.senera.light,
  "--color-paper-50": "255 255 255",
  "--color-paper-100": "249 250 251",
  "--color-paper-200": "243 244 246",
  "--color-paper-300": "229 231 235",
  "--color-paper-400": "209 213 219",
  "--color-ink-950": "3 7 18",
  "--color-ink-900": "17 24 39",
  "--color-ink-850": "31 41 55",
  "--color-ink-800": "55 65 81",
  "--color-ink-700": "75 85 99",
  "--color-ink-650": "95 105 122",
  "--color-ink-600": "107 114 128",
  "--color-ink-500": "107 114 128",
  "--color-ink-400": "156 163 175",
  "--color-ink-350": "183 190 202",
  "--color-ink-300": "209 213 219",
  "--color-ink-200": "229 231 235",
  "--color-ink-100": "243 244 246",
  "--color-ink-50": "249 250 251",
  "--theme-bg": "rgb(249 250 251)",
  "--theme-bg-image": "none",
  "--theme-fg": "rgb(17 24 39)",
  "--theme-sidebar-bg": "rgb(243 244 246)",
  "--theme-elevated-bg": "rgb(255 255 255)",
  "--theme-border": "rgb(229 231 235)",
  "--theme-accent-soft": "rgb(219 234 254)",
  "--theme-surface-shadow": "0 1px 2px rgb(17 24 39 / 0.04), 0 12px 24px rgb(17 24 39 / 0.06)",
  "--theme-panel-glaze": "rgb(255 255 255 / 0.56)",
  "--theme-hover-wash": "rgb(17 24 39 / 0.055)",
  "--theme-selection-bg": "rgb(59 130 246 / 0.18)",
  "--theme-selection-fg": "rgb(17 24 39)",
  "--theme-skeleton-a": "rgb(17 24 39 / 0.035)",
  "--theme-skeleton-b": "rgb(17 24 39 / 0.09)",
  "--theme-complete-highlight": "rgb(59 130 246 / 0.08)",
  "--theme-code-loading-bg": "rgb(255 255 255 / 0.96)",
  "--theme-code-loading-border": "rgb(17 24 39 / 0.10)",
  "--theme-code-loading-shadow": "0 12px 32px rgb(17 24 39 / 0.13)",
  "--theme-code-line-rule": "rgb(229 231 235 / 0.7)",
  "--theme-code-line-number": "rgb(107 114 128 / 0.58)",
  "--theme-canvas-grid": "rgb(17 24 39 / 0.09)",
  "--theme-node-shadow": "0 1px 2px rgb(17 24 39 / 0.035), 0 4px 12px rgb(17 24 39 / 0.09)",
  "--shadow-bubble-user": "0 1px 1px rgb(17 24 39 / 0.04)",
  "--shadow-bubble-ai": "0 1px 0 rgb(17 24 39 / 0.05), 0 0 0 1px rgb(17 24 39 / 0.045)",
  "--shadow-panel": "0 0 0 1px rgb(17 24 39 / 0.055)",
  "--shadow-soft": "0 8px 24px -12px rgb(17 24 39 / 0.16)",
  "--scrollbar-thumb": "rgb(17 24 39 / 0.15)",
  "--scrollbar-thumb-hover": "rgb(17 24 39 / 0.25)",
};
paletteTokens.classic.dark = {
  ...paletteTokens.senera.dark,
  "--color-paper-50": "31 41 55",
  "--color-paper-100": "17 24 39",
  "--color-paper-200": "31 41 55",
  "--color-paper-300": "55 65 81",
  "--color-paper-400": "75 85 99",
  "--color-ink-950": "249 250 251",
  "--color-ink-900": "249 250 251",
  "--color-ink-850": "243 244 246",
  "--color-ink-800": "229 231 235",
  "--color-ink-700": "209 213 219",
  "--color-ink-650": "186 194 205",
  "--color-ink-600": "156 163 175",
  "--color-ink-500": "156 163 175",
  "--color-ink-400": "107 114 128",
  "--color-ink-350": "75 85 99",
  "--color-ink-300": "55 65 81",
  "--color-ink-200": "55 65 81",
  "--color-ink-100": "31 41 55",
  "--color-ink-50": "17 24 39",
  "--theme-bg": "rgb(17 24 39)",
  "--theme-bg-image": "none",
  "--theme-fg": "rgb(249 250 251)",
  "--theme-sidebar-bg": "rgb(11 15 25)",
  "--theme-elevated-bg": "rgb(31 41 55)",
  "--theme-border": "rgb(55 65 81)",
  "--theme-accent-soft": "rgb(30 58 138)",
  "--theme-surface-shadow": "0 1px 2px rgb(0 0 0 / 0.30), 0 12px 24px rgb(0 0 0 / 0.40)",
  "--theme-panel-glaze": "rgb(255 255 255 / 0.045)",
  "--theme-hover-wash": "rgb(249 250 251 / 0.075)",
  "--theme-selection-bg": "rgb(96 165 250 / 0.28)",
  "--theme-selection-fg": "rgb(249 250 251)",
  "--theme-complete-highlight": "rgb(96 165 250 / 0.13)",
  "--theme-code-loading-bg": "rgb(31 41 55 / 0.96)",
  "--theme-code-loading-border": "rgb(249 250 251 / 0.10)",
  "--theme-code-loading-shadow": "0 16px 36px rgb(0 0 0 / 0.38)",
  "--theme-code-line-rule": "rgb(249 250 251 / 0.12)",
  "--theme-code-line-number": "rgb(156 163 175 / 0.62)",
  "--theme-canvas-grid": "rgb(249 250 251 / 0.07)",
  "--scrollbar-thumb": "rgb(249 250 251 / 0.18)",
  "--scrollbar-thumb-hover": "rgb(249 250 251 / 0.30)",
};
paletteTokens.forest.light = {
  ...paletteTokens.senera.light,
  "--color-paper-50": "255 255 255",
  "--color-paper-100": "245 247 245",
  "--color-paper-200": "232 236 232",
  "--color-paper-300": "209 219 209",
  "--color-paper-400": "177 194 177",
  "--color-ink-950": "28 35 28",
  "--color-ink-900": "36 43 36",
  "--color-ink-850": "45 54 45",
  "--color-ink-800": "55 68 55",
  "--color-ink-700": "75 91 75",
  "--color-ink-650": "88 104 88",
  "--color-ink-600": "99 112 99",
  "--color-ink-500": "99 112 99",
  "--color-ink-400": "129 145 129",
  "--color-ink-350": "153 169 153",
  "--color-ink-300": "177 194 177",
  "--color-ink-200": "209 219 209",
  "--color-ink-100": "232 236 232",
  "--color-ink-50": "238 241 238",
  "--theme-bg": "rgb(245 247 245)",
  "--theme-bg-image": "radial-gradient(circle at 0% 0%, rgb(90 125 76 / 0.035) 0, transparent 35%)",
  "--theme-fg": "rgb(36 43 36)",
  "--theme-sidebar-bg": "rgb(238 241 238)",
  "--theme-elevated-bg": "rgb(255 255 255)",
  "--theme-border": "rgb(209 219 209)",
  "--theme-accent-soft": "rgb(217 230 217)",
  "--theme-surface-shadow": "0 1px 2px rgb(36 43 36 / 0.03), 0 12px 24px rgb(36 43 36 / 0.06)",
  "--theme-hover-wash": "rgb(36 43 36 / 0.055)",
  "--theme-selection-bg": "rgb(75 115 75 / 0.18)",
  "--theme-selection-fg": "rgb(36 43 36)",
  "--theme-complete-highlight": "rgb(75 115 75 / 0.08)",
  "--scrollbar-thumb": "rgb(36 43 36 / 0.15)",
  "--scrollbar-thumb-hover": "rgb(36 43 36 / 0.25)",
};
paletteTokens.forest.dark = {
  ...paletteTokens.senera.dark,
  "--color-paper-50": "38 48 41",
  "--color-paper-100": "27 34 29",
  "--color-paper-200": "51 64 54",
  "--color-paper-300": "58 71 61",
  "--color-paper-400": "82 101 86",
  "--color-ink-950": "227 234 227",
  "--color-ink-900": "227 234 227",
  "--color-ink-850": "212 224 212",
  "--color-ink-800": "190 207 190",
  "--color-ink-700": "165 186 165",
  "--color-ink-650": "150 171 150",
  "--color-ink-600": "150 166 150",
  "--color-ink-500": "150 166 150",
  "--color-ink-400": "114 134 114",
  "--color-ink-350": "88 105 88",
  "--color-ink-300": "58 71 61",
  "--color-ink-200": "58 71 61",
  "--color-ink-100": "38 48 41",
  "--color-ink-50": "27 34 29",
  "--theme-bg": "rgb(27 34 29)",
  "--theme-bg-image": "radial-gradient(circle at 0% 0%, rgb(154 189 133 / 0.035) 0, transparent 35%)",
  "--theme-fg": "rgb(227 234 227)",
  "--theme-sidebar-bg": "rgb(35 43 37)",
  "--theme-elevated-bg": "rgb(38 48 41)",
  "--theme-border": "rgb(58 71 61)",
  "--theme-accent-soft": "rgb(42 64 42)",
  "--theme-surface-shadow": "0 1px 2px rgb(0 0 0 / 0.30), 0 8px 24px rgb(0 0 0 / 0.40)",
  "--theme-hover-wash": "rgb(227 234 227 / 0.075)",
  "--theme-selection-bg": "rgb(154 189 133 / 0.28)",
  "--theme-selection-fg": "rgb(227 234 227)",
  "--theme-complete-highlight": "rgb(154 189 133 / 0.13)",
  "--scrollbar-thumb": "rgb(227 234 227 / 0.18)",
  "--scrollbar-thumb-hover": "rgb(227 234 227 / 0.30)",
};

const accentTokens: Record<AccentColor, Record<ResolvedTheme, Record<string, string>>> = {
  terra: {
    light: {
      "--color-terra-50": "252 244 239",
      "--color-terra-100": "246 226 214",
      "--color-terra-200": "236 195 171",
      "--color-terra-300": "214 143 111",
      "--color-terra-400": "194 105 74",
      "--color-terra-500": "180 93 64",
      "--color-terra-600": "168 87 59",
      "--color-terra-700": "132 64 43",
    },
    dark: {
      "--color-terra-50": "71 51 39",
      "--color-terra-100": "90 58 43",
      "--color-terra-200": "122 74 54",
      "--color-terra-300": "181 109 79",
      "--color-terra-400": "204 126 91",
      "--color-terra-500": "222 142 108",
      "--color-terra-600": "233 164 135",
      "--color-terra-700": "240 180 151",
    },
  },
  violet: {
    light: {
      "--color-terra-50": "245 241 255",
      "--color-terra-100": "232 224 255",
      "--color-terra-200": "209 195 250",
      "--color-terra-300": "177 153 236",
      "--color-terra-400": "126 103 194",
      "--color-terra-500": "107 83 177",
      "--color-terra-600": "85 65 147",
      "--color-terra-700": "62 48 112",
    },
    dark: {
      "--color-terra-50": "48 41 73",
      "--color-terra-100": "60 49 92",
      "--color-terra-200": "85 66 132",
      "--color-terra-300": "139 111 214",
      "--color-terra-400": "169 143 237",
      "--color-terra-500": "188 165 250",
      "--color-terra-600": "207 190 255",
      "--color-terra-700": "226 216 255",
    },
  },
  moss: {
    light: {
      "--color-terra-50": "240 243 235",
      "--color-terra-100": "219 226 203",
      "--color-terra-200": "190 207 171",
      "--color-terra-300": "149 176 123",
      "--color-terra-400": "125 152 102",
      "--color-terra-500": "90 125 76",
      "--color-terra-600": "69 98 57",
      "--color-terra-700": "51 74 43",
    },
    dark: {
      "--color-terra-50": "31 48 38",
      "--color-terra-100": "41 61 47",
      "--color-terra-200": "61 86 62",
      "--color-terra-300": "108 148 95",
      "--color-terra-400": "130 170 114",
      "--color-terra-500": "154 189 133",
      "--color-terra-600": "182 212 157",
      "--color-terra-700": "210 232 189",
    },
  },
  sky: {
    light: {
      "--color-terra-50": "239 246 255",
      "--color-terra-100": "219 234 254",
      "--color-terra-200": "191 219 254",
      "--color-terra-300": "147 197 253",
      "--color-terra-400": "96 165 250",
      "--color-terra-500": "59 130 246",
      "--color-terra-600": "37 99 235",
      "--color-terra-700": "29 78 216",
    },
    dark: {
      "--color-terra-50": "30 58 138",
      "--color-terra-100": "30 64 175",
      "--color-terra-200": "37 99 235",
      "--color-terra-300": "59 130 246",
      "--color-terra-400": "96 165 250",
      "--color-terra-500": "96 165 250",
      "--color-terra-600": "147 197 253",
      "--color-terra-700": "191 219 254",
    },
  },
};

const visualRoleTokens: Record<ResolvedTheme, Record<string, string>> = {
  light: {
    "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
    "--theme-chat-user-fg": "rgb(var(--color-ink-900))",
    "--theme-chat-user-hover-bg": "rgb(var(--color-paper-300) / 0.80)",
    "--theme-chat-user-font-size": "14.5px",
    "--theme-chat-user-line-height": "1.55",
    "--theme-chat-assistant-font-size": "15px",
    "--theme-chat-assistant-line-height": "1.75",
    "--theme-chat-composer-bg": "rgb(var(--color-paper-100) / 0.80)",
    "--theme-chat-composer-focus-bg": "rgb(var(--color-paper-50))",
    "--theme-session-active-bg": "rgb(var(--color-ink-900) / 0.055)",
  },
  dark: {
    "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
    "--theme-chat-user-fg": "rgb(var(--color-ink-950))",
    "--theme-chat-user-hover-bg": "rgb(var(--color-paper-300))",
    "--theme-chat-user-font-size": "14.5px",
    "--theme-chat-user-line-height": "1.55",
    "--theme-chat-assistant-font-size": "15px",
    "--theme-chat-assistant-line-height": "1.75",
    "--theme-chat-composer-bg": "rgb(var(--color-paper-50) / 0.76)",
    "--theme-chat-composer-focus-bg": "rgb(var(--color-paper-50) / 0.92)",
    "--theme-session-active-bg": "rgb(var(--color-ink-900) / 0.075)",
  },
};

export function normalizeAppearancePreference(value: unknown): AppearancePreference {
  const source = value && typeof value === "object" ? (value as Partial<AppearancePreference>) : {};
  return {
    themeMode: isThemeMode(source.themeMode) ? source.themeMode : defaultAppearancePreference.themeMode,
    colorScheme: isColorScheme(source.colorScheme) ? source.colorScheme : defaultAppearancePreference.colorScheme,
    accentColor: isAccentColor(source.accentColor) ? source.accentColor : defaultAppearancePreference.accentColor,
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
  const resolvedTheme = resolveThemeMode(preference.themeMode, systemTheme);
  return {
    preference,
    resolvedTheme,
    systemTheme,
    tokens: createAppearanceTokens(preference, resolvedTheme),
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
      "--theme-font-scale": fontScaleValues[preference.fontScale],
      "--theme-ui-font-family":
        preference.fontFamily === "brand"
          ? '"Geist", ui-sans-serif, system-ui, sans-serif'
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
  return value === "senera" || value === "classic" || value === "mono" || value === "forest";
}

function isAccentColor(value: unknown): value is AccentColor {
  return value === "terra" || value === "violet" || value === "moss" || value === "sky";
}

function isAppearanceFontFamily(value: unknown): value is AppearanceFontFamily {
  return value === "brand" || value === "system";
}

function isFontScale(value: unknown): value is FontScale {
  return value === "compact" || value === "standard" || value === "comfortable" || value === "large";
}
