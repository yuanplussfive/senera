import {
  FrontendDefaultLocale,
  FrontendLocalePreferences,
  resolveFrontendLocale,
  resolveFrontendLocalePreference,
  resolveFrontendSystemLocale,
  type FrontendLocale,
  type FrontendLocalePreference,
} from "./frontendLocaleModel.js";

export const frontendLocaleStorageKey = "senera.frontendLocale";

type LocaleListener = () => void;
type StorageReader = () => Storage | undefined;
type WindowReader = () => Pick<Window, "addEventListener" | "removeEventListener"> | undefined;
type NavigatorReader = () => Pick<Navigator, "languages" | "language"> | undefined;

export interface FrontendLocaleStore {
  getSnapshot: () => FrontendLocale;
  getServerSnapshot: () => FrontendLocale;
  getPreferenceSnapshot: () => FrontendLocalePreference;
  getServerPreferenceSnapshot: () => FrontendLocalePreference;
  subscribe: (listener: LocaleListener) => () => void;
  setLocale: (locale: FrontendLocale) => void;
  setLocalePreference: (preference: FrontendLocalePreference) => void;
}

export function createFrontendLocaleStore({
  readStorage = readBrowserStorage,
  readWindow = readBrowserWindow,
  readNavigator = readBrowserNavigator,
}: {
  readStorage?: StorageReader;
  readWindow?: WindowReader;
  readNavigator?: NavigatorReader;
} = {}): FrontendLocaleStore {
  let currentPreference = readStoredLocalePreference(readStorage());
  let currentLocale = resolvePreference(currentPreference, readNavigator());
  const serverLocale = FrontendDefaultLocale;
  const serverPreference = FrontendDefaultLocale;
  let subscribers = new Set<LocaleListener>();
  let storageListener: ((event: StorageEvent) => void) | null = null;
  let languageListener: (() => void) | null = null;

  const notify = (): void => subscribers.forEach((subscriber) => subscriber());
  const readAndApplyStoredLocale = (): void => {
    const nextPreference = readStoredLocalePreference(readStorage());
    const nextLocale = resolvePreference(nextPreference, readNavigator());
    if (nextPreference === currentPreference && nextLocale === currentLocale) return;
    currentPreference = nextPreference;
    currentLocale = nextLocale;
    notify();
  };
  const startListening = (): void => {
    const windowRef = readWindow();
    if (!windowRef || storageListener) return;
    storageListener = (event) => {
      if (event.key === frontendLocaleStorageKey) readAndApplyStoredLocale();
    };
    languageListener = () => {
      if (currentPreference === FrontendLocalePreferences.System) readAndApplyStoredLocale();
    };
    windowRef.addEventListener("storage", storageListener);
    windowRef.addEventListener("languagechange", languageListener);
  };
  const stopListening = (): void => {
    const windowRef = readWindow();
    if (!windowRef) return;
    if (storageListener) {
      windowRef.removeEventListener("storage", storageListener);
      storageListener = null;
    }
    if (languageListener) {
      windowRef.removeEventListener("languagechange", languageListener);
      languageListener = null;
    }
  };

  const setLocalePreference = (preference: FrontendLocalePreference): void => {
    const nextPreference = resolveFrontendLocalePreference(preference);
    const nextLocale = resolvePreference(nextPreference, readNavigator());
    if (nextPreference === currentPreference && nextLocale === currentLocale) return;
    currentPreference = nextPreference;
    currentLocale = nextLocale;
    writeStoredLocale(readStorage(), nextPreference);
    notify();
  };

  const setLocale = (locale: FrontendLocale): void => {
    setLocalePreference(resolveFrontendLocale(locale));
  };

  return {
    getSnapshot: () => currentLocale,
    getServerSnapshot: () => serverLocale,
    getPreferenceSnapshot: () => currentPreference,
    getServerPreferenceSnapshot: () => serverPreference,
    subscribe: (listener) => {
      subscribers.add(listener);
      if (subscribers.size === 1) startListening();
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0) {
          stopListening();
          subscribers = new Set();
        }
      };
    },
    setLocale,
    setLocalePreference,
  };
}

export const frontendLocaleStore = createFrontendLocaleStore();

export function getFrontendLocale(): FrontendLocale {
  return frontendLocaleStore.getSnapshot();
}

export function setFrontendLocale(locale: FrontendLocale): void {
  frontendLocaleStore.setLocale(locale);
}

export function getFrontendLocalePreference(): FrontendLocalePreference {
  return frontendLocaleStore.getPreferenceSnapshot();
}

export function setFrontendLocalePreference(preference: FrontendLocalePreference): void {
  frontendLocaleStore.setLocalePreference(preference);
}

function readStoredLocalePreference(storage: Storage | undefined): FrontendLocalePreference {
  if (!storage) return FrontendDefaultLocale;
  try {
    return resolveFrontendLocalePreference(storage.getItem(frontendLocaleStorageKey));
  } catch {
    return FrontendDefaultLocale;
  }
}

function writeStoredLocale(storage: Storage | undefined, preference: FrontendLocalePreference): void {
  if (!storage) return;
  try {
    storage.setItem(frontendLocaleStorageKey, preference);
  } catch {
    // Locale persistence is best-effort; the current process still updates.
  }
}

function readBrowserStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function readBrowserWindow(): Pick<Window, "addEventListener" | "removeEventListener"> | undefined {
  return typeof window === "undefined" ? undefined : window;
}

function readBrowserNavigator(): Pick<Navigator, "languages" | "language"> | undefined {
  return typeof navigator === "undefined" ? undefined : navigator;
}

function resolvePreference(
  preference: FrontendLocalePreference,
  navigatorRef: Pick<Navigator, "languages" | "language"> | undefined,
): FrontendLocale {
  if (preference !== FrontendLocalePreferences.System) return preference;
  const languages = navigatorRef ? [...navigatorRef.languages, navigatorRef.language] : [];
  return resolveFrontendSystemLocale(languages);
}
