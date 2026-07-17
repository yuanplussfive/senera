import { describe, expect, it, vi } from "vitest";
import { appearancePreferenceStorageKey } from "../../../Frontend/src/shared/theme/themeModel.ts";
import { createAppearanceStore } from "../../../Frontend/src/shared/theme/themeStore.ts";
function createMatchMediaMock(initialDark = false) {
  let media = null;
  const matchMedia = vi.fn((query) => {
    if (media) return media;
    const listeners = new Set();
    let matches = initialDark;
    media = {
      media: query,
      get matches() {
        return matches;
      },
      onchange: null,
      addEventListener: vi.fn((_type, listener) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_type, listener) => {
        listeners.delete(listener);
      }),
      addListener: vi.fn((listener) => {
        listeners.add(listener);
      }),
      removeListener: vi.fn((listener) => {
        listeners.delete(listener);
      }),
      dispatchEvent: vi.fn(() => true),
      emit: () => {
        listeners.forEach((listener) => listener({ matches, media: query }));
      },
      listenerCount: () => listeners.size,
      setMatches: (nextMatches) => {
        matches = nextMatches;
      },
    };
    return media;
  });
  return { getMedia: () => media, matchMedia };
}
function createStorageMock(initial) {
  const values = new Map();
  if (initial) values.set(appearancePreferenceStorageKey, JSON.stringify(initial));
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key) => values.get(key) ?? null),
    key: vi.fn((index) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key) => {
      values.delete(key);
    }),
    setItem: vi.fn((key, value) => {
      values.set(key, value);
    }),
  };
}
function createWindowMock() {
  const listeners = new Set();
  return {
    windowRef: {
      addEventListener: vi.fn((_type, listener) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_type, listener) => {
        listeners.delete(listener);
      }),
    },
    emitStorage: (key) => {
      listeners.forEach((listener) => listener({ key }));
    },
    listenerCount: () => listeners.size,
  };
}
describe("createAppearanceStore", () => {
  it("persists partial preference updates and resolves them immediately", () => {
    const storage = createStorageMock();
    const { matchMedia } = createMatchMediaMock(false);
    const store = createAppearanceStore({
      readMatchMedia: () => matchMedia,
      readStorage: () => storage,
      readWindow: () => undefined,
    });
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);
    store.setPreference({ themeMode: "dark", accentColor: "violet" });
    expect(storage.setItem).toHaveBeenCalledWith(
      appearancePreferenceStorageKey,
      JSON.stringify({
        themeMode: "dark",
        colorScheme: "classic",
        accentColor: "violet",
        fontFamily: "brand",
        fontScale: "standard",
      }),
    );
    expect(store.getSnapshot()).toMatchObject({
      preference: { themeMode: "dark", accentColor: "violet" },
      resolvedTheme: "dark",
    });
    expect(subscriber).toHaveBeenCalled();
    unsubscribe();
  });
  it("updates a system theme preference when prefers-color-scheme changes", () => {
    const storage = createStorageMock({ themeMode: "system" });
    const { getMedia, matchMedia } = createMatchMediaMock(false);
    const store = createAppearanceStore({
      readMatchMedia: () => matchMedia,
      readStorage: () => storage,
      readWindow: () => undefined,
    });
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);
    getMedia()?.setMatches(true);
    getMedia()?.emit();
    expect(store.getSnapshot()).toMatchObject({
      preference: { themeMode: "system" },
      resolvedTheme: "dark",
      systemTheme: "dark",
    });
    expect(subscriber).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(getMedia()?.listenerCount()).toBe(0);
  });
  it("responds to appearance preference storage changes from another tab", () => {
    const storage = createStorageMock({ themeMode: "system" });
    const windowMock = createWindowMock();
    const { matchMedia } = createMatchMediaMock(false);
    const store = createAppearanceStore({
      readMatchMedia: () => matchMedia,
      readStorage: () => storage,
      readWindow: () => windowMock.windowRef,
    });
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);
    storage.setItem(appearancePreferenceStorageKey, JSON.stringify({ themeMode: "dark", fontScale: "large" }));
    windowMock.emitStorage(appearancePreferenceStorageKey);
    expect(store.getSnapshot()).toMatchObject({
      preference: { themeMode: "dark", fontScale: "large" },
      resolvedTheme: "dark",
    });
    expect(subscriber).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(windowMock.listenerCount()).toBe(0);
  });
});
