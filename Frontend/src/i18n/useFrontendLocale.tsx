import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { frontendLocaleStore, getFrontendLocale, setFrontendLocale } from "./frontendLocaleStore.js";
import type { FrontendLocale } from "./frontendLocaleModel.js";

export function useFrontendLocale(): FrontendLocale {
  return useSyncExternalStore(
    frontendLocaleStore.subscribe,
    frontendLocaleStore.getSnapshot,
    frontendLocaleStore.getServerSnapshot,
  );
}

export function useSetFrontendLocale(): (locale: FrontendLocale) => void {
  return setFrontendLocale;
}

export function FrontendI18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const locale = useFrontendLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <>{children}</>;
}

export { getFrontendLocale };
