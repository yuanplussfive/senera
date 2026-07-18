export const FrontendLocales = {
  ZhCn: "zh-CN",
  EnUs: "en-US",
} as const;

export type FrontendLocale = (typeof FrontendLocales)[keyof typeof FrontendLocales];

export const FrontendDefaultLocale = FrontendLocales.ZhCn;

export function isFrontendLocale(value: string): value is FrontendLocale {
  return Object.values(FrontendLocales).includes(value as FrontendLocale);
}

export function resolveFrontendLocale(value: string | null | undefined): FrontendLocale {
  return value && isFrontendLocale(value) ? value : FrontendDefaultLocale;
}
