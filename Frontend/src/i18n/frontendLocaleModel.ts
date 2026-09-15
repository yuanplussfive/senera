export const FrontendLocales = {
  ZhCn: "zh-CN",
  EnUs: "en-US",
} as const;

export type FrontendLocale = (typeof FrontendLocales)[keyof typeof FrontendLocales];

export const FrontendLocalePreferences = {
  System: "system",
  ZhCn: FrontendLocales.ZhCn,
  EnUs: FrontendLocales.EnUs,
} as const;

export type FrontendLocalePreference = (typeof FrontendLocalePreferences)[keyof typeof FrontendLocalePreferences];

export type FrontendLocalizedText = Readonly<Record<FrontendLocale, string>>;

export const FrontendDefaultLocale = FrontendLocales.ZhCn;

export function isFrontendLocale(value: string): value is FrontendLocale {
  return Object.values(FrontendLocales).includes(value as FrontendLocale);
}

export function resolveFrontendLocale(value: string | null | undefined): FrontendLocale {
  return value && isFrontendLocale(value) ? value : FrontendDefaultLocale;
}

export function isFrontendLocalePreference(value: string): value is FrontendLocalePreference {
  return Object.values(FrontendLocalePreferences).includes(value as FrontendLocalePreference);
}

export function resolveFrontendLocalePreference(value: string | null | undefined): FrontendLocalePreference {
  return value && isFrontendLocalePreference(value) ? value : FrontendDefaultLocale;
}

export function resolveFrontendSystemLocale(languages: readonly string[]): FrontendLocale {
  for (const language of languages) {
    const baseLanguage = language.trim().toLowerCase().split("-", 1)[0];
    if (baseLanguage === "zh") return FrontendLocales.ZhCn;
    if (baseLanguage === "en") return FrontendLocales.EnUs;
  }
  return FrontendDefaultLocale;
}

export function resolveFrontendLocalizedText(
  text: FrontendLocalizedText,
  locale: FrontendLocale = FrontendDefaultLocale,
): string {
  return text[locale] || text[FrontendDefaultLocale];
}
