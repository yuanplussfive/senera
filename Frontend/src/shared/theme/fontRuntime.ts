import type { AppearanceFontFamily } from "./themeModel";

const fontLoaders: Record<AppearanceFontFamily, () => Promise<unknown>> = {
  brand: () => Promise.resolve(),
  fresh: () => Promise.resolve(),
  system: () => Promise.resolve(),
};

const fontLoadPromises = new Map<AppearanceFontFamily, Promise<void>>();

export function ensureAppearanceFontLoaded(fontFamily: AppearanceFontFamily): Promise<void> {
  const existing = fontLoadPromises.get(fontFamily);
  if (existing) return existing;

  const promise = fontLoaders[fontFamily]().then(() => undefined);
  fontLoadPromises.set(fontFamily, promise);
  return promise;
}
