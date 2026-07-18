import { FrontendDefaultLocale, resolveFrontendLocale, type FrontendLocale } from "./frontendLocaleModel.js";

export const frontendLocaleStorageKey = "senera.frontendLocale";

type LocaleListener = () => void;
type StorageReader = () => Storage | undefined;
type WindowReader = () => Pick<Window, "addEventListener" | "removeEventListener"> | undefined;

export interface FrontendLocaleStore {
  getSnapshot: () => FrontendLocale;
  getServerSnapshot: () => FrontendLocale;
  subscribe: (listener: LocaleListener) => () => void;
  setLocale: (locale: FrontendLocale) => void;
}

export function createFrontendLocaleStore({
  readStorage = readBrowserStorage,
  readWindow = readBrowserWindow,
}: {
  readStorage?: StorageReader;
  readWindow?: WindowReader;
} = {}): FrontendLocaleStore {
  let currentLocale = readStoredLocale(readStorage());
  const serverLocale = FrontendDefaultLocale;
  let subscribers = new Set<LocaleListener>();
  let storageListener: ((event: StorageEvent) => void) | null = null;

  const notify = (): void => subscribers.forEach((subscriber) => subscriber());
  const readAndApplyStoredLocale = (): void => {
    const nextLocale = readStoredLocale(readStorage());
    if (nextLocale === currentLocale) return;
    currentLocale = nextLocale;
    notify();
  };
  const startListening = (): void => {
    const windowRef = readWindow();
    if (!windowRef || storageListener) return;
    storageListener = (event) => {
      if (event.key === frontendLocaleStorageKey) readAndApplyStoredLocale();
    };
    windowRef.addEventListener("storage", storageListener);
  };
  const stopListening = (): void => {
    const windowRef = readWindow();
    if (!windowRef || !storageListener) return;
    windowRef.removeEventListener("storage", storageListener);
    storageListener = null;
  };

  return {
    getSnapshot: () => currentLocale,
    getServerSnapshot: () => serverLocale,
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
    setLocale: (locale) => {
      const nextLocale = resolveFrontendLocale(locale);
      if (nextLocale === currentLocale) return;
      currentLocale = nextLocale;
      writeStoredLocale(readStorage(), nextLocale);
      notify();
    },
  };
}

export const frontendLocaleStore = createFrontendLocaleStore();

export function getFrontendLocale(): FrontendLocale {
  return frontendLocaleStore.getSnapshot();
}

export function setFrontendLocale(locale: FrontendLocale): void {
  frontendLocaleStore.setLocale(locale);
}

function readStoredLocale(storage: Storage | undefined): FrontendLocale {
  if (!storage) return FrontendDefaultLocale;
  try {
    return resolveFrontendLocale(storage.getItem(frontendLocaleStorageKey));
  } catch {
    return FrontendDefaultLocale;
  }
}

function writeStoredLocale(storage: Storage | undefined, locale: FrontendLocale): void {
  if (!storage) return;
  try {
    storage.setItem(frontendLocaleStorageKey, locale);
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
