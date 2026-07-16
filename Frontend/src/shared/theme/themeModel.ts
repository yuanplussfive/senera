export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type ColorScheme = "senera" | "monochrome" | "nordic" | "sepia" | "lavender" | "ocean";
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
export const colorSchemes = [
  "senera",
  "monochrome",
  "nordic",
  "sepia",
  "lavender",
  "ocean",
] as const satisfies readonly ColorScheme[];
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
      "--color-paper-100": "247 247 248",
      "--color-paper-200": "239 240 242",
      "--color-paper-300": "222 224 228",
      "--color-paper-400": "196 199 205",
      "--color-ink-950": "24 25 28",
      "--color-ink-900": "31 32 36",
      "--color-ink-850": "42 43 48",
      "--color-ink-800": "55 57 63",
      "--color-ink-700": "72 75 82",
      "--color-ink-650": "87 90 98",
      "--color-ink-600": "101 104 113",
      "--color-ink-500": "112 116 126",
      "--color-ink-400": "145 149 158",
      "--color-ink-350": "165 169 177",
      "--color-ink-300": "184 188 196",
      "--color-ink-200": "222 224 228",
      "--color-ink-100": "234 236 239",
      "--color-ink-50": "245 246 247",
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
      "--theme-bg": "rgb(247 247 248)",
      "--theme-bg-image": "none",
      "--theme-fg": "rgb(31 32 36)",
      "--theme-sidebar-bg": "rgb(245 246 247)",
      "--theme-elevated-bg": "rgb(255 255 255)",
      "--theme-border": "rgb(222 224 228)",
      "--theme-accent-soft": "var(--accent-surface)",
      "--theme-surface-shadow": "0 1px 2px rgb(24 25 28 / 0.06), 0 6px 14px -8px rgb(24 25 28 / 0.14)",
      "--theme-panel-glaze": "rgb(255 255 255)",
      "--theme-hover-wash": "var(--surface-hover)",
      "--theme-selection-bg": "rgb(var(--color-accent-500) / 0.18)",
      "--theme-selection-fg": "var(--content-primary)",
      "--theme-skeleton-a": "rgb(43 40 32 / 0.035)",
      "--theme-skeleton-b": "rgb(43 40 32 / 0.09)",
      "--theme-complete-highlight": "rgb(var(--color-accent-500) / 0.08)",
      "--theme-code-editor-bg": "rgb(255 255 255)",
      "--theme-code-editor-fg": "rgb(var(--color-ink-850))",
      "--theme-code-editor-gutter-bg": "rgb(var(--color-paper-200) / 0.72)",
      "--theme-code-editor-gutter-border": "rgb(var(--color-ink-900) / 0.10)",
      "--theme-code-editor-gutter-fg": "rgb(var(--color-ink-900) / 0.42)",
      "--theme-code-editor-active-line-bg": "rgb(var(--color-accent-500) / 0.07)",
      "--theme-code-editor-active-gutter-bg": "rgb(var(--color-accent-500) / 0.09)",
      "--theme-code-editor-active-gutter-fg": "rgb(var(--color-accent-700))",
      "--theme-code-editor-selection-bg": "rgb(var(--color-accent-500) / 0.18)",
      "--theme-code-editor-caret": "rgb(var(--color-accent-500))",
      "--theme-code-token-keyword": "rgb(var(--color-accent-600))",
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
      "--color-paper-50": "36 37 40",
      "--color-paper-100": "28 29 32",
      "--color-paper-200": "44 45 49",
      "--color-paper-300": "55 56 61",
      "--color-paper-400": "82 84 91",
      "--color-ink-950": "250 250 251",
      "--color-ink-900": "241 242 244",
      "--color-ink-850": "226 228 232",
      "--color-ink-800": "209 212 218",
      "--color-ink-700": "188 192 200",
      "--color-ink-650": "173 177 186",
      "--color-ink-600": "153 157 167",
      "--color-ink-500": "135 139 149",
      "--color-ink-400": "112 116 126",
      "--color-ink-350": "92 95 104",
      "--color-ink-300": "73 76 83",
      "--color-ink-200": "55 56 61",
      "--color-ink-100": "45 46 50",
      "--color-ink-50": "35 36 39",
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
      "--theme-bg": "rgb(28 29 32)",
      "--theme-bg-image": "none",
      "--theme-fg": "rgb(241 242 244)",
      "--theme-sidebar-bg": "rgb(23 24 27)",
      "--theme-elevated-bg": "rgb(36 37 40)",
      "--theme-border": "rgb(55 56 61)",
      "--theme-accent-soft": "var(--accent-surface)",
      "--theme-surface-shadow": "0 1px 2px rgb(0 0 0 / 0.34), 0 8px 18px -10px rgb(0 0 0 / 0.68)",
      "--theme-panel-glaze": "rgb(255 255 255 / 0.035)",
      "--theme-hover-wash": "var(--surface-hover)",
      "--theme-selection-bg": "rgb(var(--color-accent-500) / 0.26)",
      "--theme-selection-fg": "var(--content-strong)",
      "--theme-skeleton-a": "rgb(239 235 223 / 0.045)",
      "--theme-skeleton-b": "rgb(239 235 223 / 0.10)",
      "--theme-complete-highlight": "rgb(var(--color-accent-500) / 0.13)",
      "--theme-code-editor-bg": "rgb(var(--color-paper-100))",
      "--theme-code-editor-fg": "rgb(var(--color-ink-900))",
      "--theme-code-editor-gutter-bg": "rgb(var(--color-paper-50) / 0.66)",
      "--theme-code-editor-gutter-border": "rgb(var(--color-ink-900) / 0.10)",
      "--theme-code-editor-gutter-fg": "rgb(var(--color-ink-600) / 0.72)",
      "--theme-code-editor-active-line-bg": "rgb(var(--color-accent-500) / 0.11)",
      "--theme-code-editor-active-gutter-bg": "rgb(var(--color-accent-500) / 0.14)",
      "--theme-code-editor-active-gutter-fg": "rgb(var(--color-accent-700))",
      "--theme-code-editor-selection-bg": "rgb(var(--color-accent-500) / 0.26)",
      "--theme-code-editor-caret": "rgb(var(--color-accent-500))",
      "--theme-code-token-keyword": "rgb(var(--color-accent-600))",
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
  monochrome: {
    light: {},
    dark: {},
  },
  nordic: {
    light: {},
    dark: {},
  },
  sepia: {
    light: {},
    dark: {},
  },
  lavender: {
    light: {},
    dark: {},
  },
  ocean: {
    light: {},
    dark: {},
  },
};

paletteTokens.monochrome.light = {
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
  "--theme-sidebar-bg": "rgb(229 229 229)",
  "--theme-elevated-bg": "rgb(255 255 255)",
  "--theme-border": "rgb(212 212 212)",
  "--theme-accent-soft": "rgb(229 229 229)",
};

paletteTokens.monochrome.dark = {
  ...paletteTokens.senera.dark,
  "--color-paper-50": "10 10 10",
  "--color-paper-100": "23 23 23",
  "--color-paper-200": "38 38 38",
  "--color-paper-300": "64 64 64",
  "--color-paper-400": "82 82 82",
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
  "--theme-sidebar-bg": "rgb(0 0 0)",
  "--theme-elevated-bg": "rgb(23 23 23)",
  "--theme-border": "rgb(38 38 38)",
  "--theme-accent-soft": "rgb(38 38 38)",
};

paletteTokens.nordic.light = {
  ...paletteTokens.senera.light,
  "--color-paper-50": "255 255 255",
  "--color-paper-100": "248 249 251",
  "--color-paper-200": "236 239 244",
  "--color-paper-300": "229 233 240",
  "--color-paper-400": "216 222 233",
  "--color-ink-950": "46 52 64",
  "--color-ink-900": "59 66 82",
  "--color-ink-850": "67 76 94",
  "--color-ink-800": "76 86 106",
  "--color-ink-500": "129 161 193",
  "--theme-bg": "rgb(248 249 251)",
  "--theme-sidebar-bg": "rgb(236 239 244)",
  "--theme-elevated-bg": "rgb(255 255 255)",
  "--theme-border": "rgb(229 233 240)",
};

paletteTokens.nordic.dark = {
  ...paletteTokens.senera.dark,
  "--color-paper-50": "46 52 64",
  "--color-paper-100": "59 66 82",
  "--color-paper-200": "67 76 94",
  "--color-paper-300": "76 86 106",
  "--color-paper-400": "94 129 172",
  "--color-ink-950": "236 239 244",
  "--color-ink-900": "229 233 240",
  "--color-ink-850": "216 222 233",
  "--color-ink-800": "180 142 173",
  "--color-ink-500": "136 192 208",
  "--theme-bg": "rgb(46 52 64)",
  "--theme-sidebar-bg": "rgb(59 66 82)",
  "--theme-elevated-bg": "rgb(67 76 94)",
  "--theme-border": "rgb(76 86 106)",
};

paletteTokens.sepia.light = {
  ...paletteTokens.senera.light,
  "--color-paper-50": "253 246 227",
  "--color-paper-100": "238 232 213",
  "--color-paper-200": "220 214 196",
  "--color-paper-300": "202 196 179",
  "--color-ink-950": "101 123 131",
  "--color-ink-900": "88 110 117",
  "--theme-bg": "rgb(238 232 213)",
  "--theme-sidebar-bg": "rgb(220 214 196)",
  "--theme-elevated-bg": "rgb(253 246 227)",
  "--theme-border": "rgb(202 196 179)",
};

paletteTokens.sepia.dark = {
  ...paletteTokens.senera.dark,
  "--color-paper-50": "0 43 54",
  "--color-paper-100": "7 54 66",
  "--color-paper-200": "23 70 82",
  "--color-ink-950": "147 161 161",
  "--color-ink-900": "131 148 150",
  "--theme-bg": "rgb(0 43 54)",
  "--theme-sidebar-bg": "rgb(7 54 66)",
  "--theme-elevated-bg": "rgb(23 70 82)",
  "--theme-border": "rgb(88 110 117)",
};

paletteTokens.lavender.light = {
  ...paletteTokens.senera.light,
  "--color-paper-50": "255 255 255",
  "--color-paper-100": "250 248 252",
  "--color-paper-200": "243 239 248",
  "--color-paper-300": "230 223 238",
  "--color-ink-950": "44 38 52",
  "--color-ink-900": "65 57 76",
  "--theme-bg": "rgb(250 248 252)",
  "--theme-sidebar-bg": "rgb(243 239 248)",
  "--theme-elevated-bg": "rgb(255 255 255)",
  "--theme-border": "rgb(230 223 238)",
};

paletteTokens.lavender.dark = {
  ...paletteTokens.senera.dark,
  "--color-paper-50": "24 21 28",
  "--color-paper-100": "34 30 40",
  "--color-paper-200": "44 38 52",
  "--color-ink-950": "243 239 248",
  "--color-ink-900": "230 223 238",
  "--theme-bg": "rgb(24 21 28)",
  "--theme-sidebar-bg": "rgb(34 30 40)",
  "--theme-elevated-bg": "rgb(44 38 52)",
  "--theme-border": "rgb(65 57 76)",
};

paletteTokens.ocean.light = {
  ...paletteTokens.senera.light,
  "--color-paper-50": "255 255 255",
  "--color-paper-100": "240 248 255",
  "--color-paper-200": "224 240 255",
  "--color-ink-950": "10 37 64",
  "--color-ink-900": "21 52 87",
  "--theme-bg": "rgb(240 248 255)",
  "--theme-sidebar-bg": "rgb(224 240 255)",
  "--theme-elevated-bg": "rgb(255 255 255)",
  "--theme-border": "rgb(194 220 245)",
};

paletteTokens.ocean.dark = {
  ...paletteTokens.senera.dark,
  "--color-paper-50": "10 25 41",
  "--color-paper-100": "15 35 56",
  "--color-paper-200": "21 52 87",
  "--color-ink-950": "224 240 255",
  "--color-ink-900": "194 220 245",
  "--theme-bg": "rgb(10 25 41)",
  "--theme-sidebar-bg": "rgb(15 35 56)",
  "--theme-elevated-bg": "rgb(21 52 87)",
  "--theme-border": "rgb(34 77 122)",
};

const accentTokens: Record<AccentColor, Record<ResolvedTheme, Record<string, string>>> = {
  terra: {
    light: {
      "--color-accent-50": "252 244 239",
      "--color-accent-100": "246 226 214",
      "--color-accent-200": "236 195 171",
      "--color-accent-300": "214 143 111",
      "--color-accent-400": "194 105 74",
      "--color-accent-500": "180 93 64",
      "--color-accent-600": "168 87 59",
      "--color-accent-700": "132 64 43",
      "--color-accent-contrast": "255 255 255",
    },
    dark: {
      "--color-accent-50": "71 51 39",
      "--color-accent-100": "90 58 43",
      "--color-accent-200": "122 74 54",
      "--color-accent-300": "181 109 79",
      "--color-accent-400": "204 126 91",
      "--color-accent-500": "222 142 108",
      "--color-accent-600": "233 164 135",
      "--color-accent-700": "240 180 151",
      "--color-accent-contrast": "24 25 28",
    },
  },
  violet: {
    light: {
      "--color-accent-50": "245 241 255",
      "--color-accent-100": "232 224 255",
      "--color-accent-200": "209 195 250",
      "--color-accent-300": "177 153 236",
      "--color-accent-400": "126 103 194",
      "--color-accent-500": "107 83 177",
      "--color-accent-600": "85 65 147",
      "--color-accent-700": "62 48 112",
      "--color-accent-contrast": "255 255 255",
    },
    dark: {
      "--color-accent-50": "48 41 73",
      "--color-accent-100": "60 49 92",
      "--color-accent-200": "85 66 132",
      "--color-accent-300": "139 111 214",
      "--color-accent-400": "169 143 237",
      "--color-accent-500": "188 165 250",
      "--color-accent-600": "207 190 255",
      "--color-accent-700": "226 216 255",
      "--color-accent-contrast": "24 25 28",
    },
  },
  moss: {
    light: {
      "--color-accent-50": "240 243 235",
      "--color-accent-100": "219 226 203",
      "--color-accent-200": "190 207 171",
      "--color-accent-300": "149 176 123",
      "--color-accent-400": "125 152 102",
      "--color-accent-500": "90 125 76",
      "--color-accent-600": "69 98 57",
      "--color-accent-700": "51 74 43",
      "--color-accent-contrast": "255 255 255",
    },
    dark: {
      "--color-accent-50": "31 48 38",
      "--color-accent-100": "41 61 47",
      "--color-accent-200": "61 86 62",
      "--color-accent-300": "108 148 95",
      "--color-accent-400": "130 170 114",
      "--color-accent-500": "154 189 133",
      "--color-accent-600": "182 212 157",
      "--color-accent-700": "210 232 189",
      "--color-accent-contrast": "24 25 28",
    },
  },
  sky: {
    light: {
      "--color-accent-50": "239 246 255",
      "--color-accent-100": "219 234 254",
      "--color-accent-200": "191 219 254",
      "--color-accent-300": "147 197 253",
      "--color-accent-400": "96 165 250",
      "--color-accent-500": "59 130 246",
      "--color-accent-600": "37 99 235",
      "--color-accent-700": "29 78 216",
      "--color-accent-contrast": "24 25 28",
    },
    dark: {
      "--color-accent-50": "30 58 138",
      "--color-accent-100": "30 64 175",
      "--color-accent-200": "37 99 235",
      "--color-accent-300": "59 130 246",
      "--color-accent-400": "96 165 250",
      "--color-accent-500": "96 165 250",
      "--color-accent-600": "147 197 253",
      "--color-accent-700": "191 219 254",
      "--color-accent-contrast": "24 25 28",
    },
  },
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
    "--theme-session-active-bg": "var(--accent-surface)",
    "--theme-overlay-shadow": "0 30px 72px -26px rgb(24 25 28 / 0.42), 0 10px 28px -16px rgb(24 25 28 / 0.24)",
    "--theme-dialog-backdrop": "rgb(24 25 28 / 0.52)",
    "--theme-sheet-backdrop": "rgb(24 25 28 / 0.44)",
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
    "--theme-session-active-bg": "var(--accent-surface)",
    "--theme-overlay-shadow": "0 30px 76px -22px rgb(0 0 0 / 0.82), 0 12px 32px -18px rgb(0 0 0 / 0.68)",
    "--theme-dialog-backdrop": "rgb(0 0 0 / 0.68)",
    "--theme-sheet-backdrop": "rgb(0 0 0 / 0.58)",
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
      ...semanticColorRoleTokens[resolvedTheme],
      "--theme-font-scale": fontScaleValues[preference.fontScale],
      "--theme-ui-font-family":
        preference.fontFamily === "brand"
          ? '"Segoe UI Variable", "Segoe UI", ui-sans-serif, system-ui, sans-serif'
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
  return (
    value === "senera" ||
    value === "monochrome" ||
    value === "nordic" ||
    value === "sepia" ||
    value === "lavender" ||
    value === "ocean"
  );
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
