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

type AppearanceBootstrapScriptConfig = readonly [
  storageKey: string,
  defaultPreference: AppearancePreference,
  preferencePropertyNames: readonly string[],
  validPreferenceValues: readonly (readonly string[])[],
  accentColorByScheme: readonly string[],
  firstPaintCssVariableNames: readonly string[],
  firstPaintTokenValues: readonly string[],
  firstPaintTokenValueIndexes: readonly (readonly (readonly number[])[])[],
];

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
  "--theme-skeleton-a",
  "--theme-skeleton-b",
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
  const firstPaintTokenValues: string[] = [];
  const firstPaintTokenValueIndexes = new Map<string, number>();
  const registerTokenValue = (value: string): number => {
    const registeredIndex = firstPaintTokenValueIndexes.get(value);
    if (registeredIndex !== undefined) return registeredIndex;
    const nextIndex = firstPaintTokenValues.length;
    firstPaintTokenValues.push(value);
    firstPaintTokenValueIndexes.set(value, nextIndex);
    return nextIndex;
  };
  const resolveTokenIndexes = (colorScheme: ColorScheme, resolvedTheme: ResolvedTheme): number[] =>
    firstPaintCssVariableNames.map((name) => {
      const value = config.firstPaintTokens[colorScheme][resolvedTheme][name];
      if (value === undefined) throw new Error(`Missing first-paint token: ${colorScheme}.${resolvedTheme}.${name}`);
      return registerTokenValue(value);
    });
  const preferencePropertyNames = Object.keys(config.defaultPreference);
  const serializedConfig: AppearanceBootstrapScriptConfig = [
    config.storageKey,
    config.defaultPreference,
    preferencePropertyNames,
    [
      config.validPreferenceValues.themeMode,
      config.validPreferenceValues.colorScheme,
      config.validPreferenceValues.accentColor,
      config.validPreferenceValues.fontFamily,
      config.validPreferenceValues.fontScale,
    ],
    colorSchemes.map((colorScheme) => config.accentColorByScheme[colorScheme]),
    firstPaintCssVariableNames,
    firstPaintTokenValues,
    colorSchemes.map((colorScheme) => [
      resolveTokenIndexes(colorScheme, "light"),
      resolveTokenIndexes(colorScheme, "dark"),
    ]),
  ];
  return `(()=>{const[e,t,a,n,l,o,r,c]=${JSON.stringify(serializedConfig)},s=document.documentElement,f=i=>{let d={};try{d=i?JSON.parse(i):{}}catch{}const p=Object.fromEntries(a.map((v,h)=>[v,n[h].includes(d[v])?d[v]:t[v]])),h=a.indexOf("colorScheme");return p.accentColor=l[n[h].indexOf(p.colorScheme)]??t.accentColor,p};let u=t;try{u=f(window.localStorage.getItem(e))}catch{}const g=window.matchMedia?.("(prefers-color-scheme: dark)").matches?"dark":"light",y=u.themeMode==="system"?g:u.themeMode,m=c[n[a.indexOf("colorScheme")].indexOf(u.colorScheme)]?.[y==="dark"?1:0]??[];o.forEach((v,h)=>{const b=r[m[h]];b&&s.style.setProperty(v,b)}),s.dataset.theme=y,s.dataset.themePreference=u.themeMode,s.dataset.colorScheme=u.colorScheme,s.dataset.accentColor=u.accentColor,s.dataset.fontFamily=u.fontFamily,s.dataset.fontScale=u.fontScale,s.style.colorScheme=y})();`;
}
