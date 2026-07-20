// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import enUsMessages from "../../../Frontend/src/i18n/messages/en-US.json" with { type: "json" };
import zhCnMessages from "../../../Frontend/src/i18n/messages/zh-CN.json" with { type: "json" };
import {
  FrontendDefaultLocale,
  FrontendLocales,
  frontendMessage,
} from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import {
  createFrontendLocaleStore,
  frontendLocaleStorageKey,
  setFrontendLocale,
} from "../../../Frontend/src/i18n/frontendLocaleStore.ts";
import { FrontendI18nProvider } from "../../../Frontend/src/i18n/useFrontendLocale.tsx";

afterEach(() => {
  cleanup();
  setFrontendLocale(FrontendDefaultLocale);
  window.localStorage.removeItem(frontendLocaleStorageKey);
  document.documentElement.lang = "";
});

describe("frontend locale store", () => {
  test("persists locale changes and falls back from unsupported stored values", () => {
    const validStorage = createMemoryStorage();
    const store = createFrontendLocaleStore({ readStorage: () => validStorage });

    store.setLocale(FrontendLocales.EnUs);

    expect(store.getSnapshot()).toBe(FrontendLocales.EnUs);
    expect(validStorage.getItem(frontendLocaleStorageKey)).toBe(FrontendLocales.EnUs);

    const invalidStorage = createMemoryStorage({ [frontendLocaleStorageKey]: "fr-FR" });
    const fallbackStore = createFrontendLocaleStore({ readStorage: () => invalidStorage });
    expect(fallbackStore.getSnapshot()).toBe(FrontendDefaultLocale);
  });

  test("synchronizes subscribers when another window changes locale storage", () => {
    const storage = createMemoryStorage({ [frontendLocaleStorageKey]: FrontendLocales.ZhCn });
    const storageEvents = createStorageEventTarget();
    const listener = vi.fn();
    const store = createFrontendLocaleStore({
      readStorage: () => storage,
      readWindow: () => storageEvents.window,
    });
    const unsubscribe = store.subscribe(listener);

    storage.setItem(frontendLocaleStorageKey, FrontendLocales.EnUs);
    storageEvents.dispatch(frontendLocaleStorageKey);

    expect(store.getSnapshot()).toBe(FrontendLocales.EnUs);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    storage.setItem(frontendLocaleStorageKey, FrontendLocales.ZhCn);
    storageEvents.dispatch(frontendLocaleStorageKey);
    expect(store.getSnapshot()).toBe(FrontendLocales.EnUs);
  });
});

describe("frontend locale integration", () => {
  test("uses the current locale for messages when no explicit locale is supplied", () => {
    setFrontendLocale(FrontendLocales.EnUs);
    expect(frontendMessage("ui.close")).toBe("Close");

    setFrontendLocale(FrontendLocales.ZhCn);
    expect(frontendMessage("ui.close")).toBe("关闭");
  });

  test("keeps the document language synchronized with the locale store", async () => {
    setFrontendLocale(FrontendLocales.ZhCn);
    render(React.createElement(FrontendI18nProvider, null, React.createElement("span", null, "content")));

    await waitFor(() => expect(document.documentElement.lang).toBe(FrontendLocales.ZhCn));

    act(() => setFrontendLocale(FrontendLocales.EnUs));
    await waitFor(() => expect(document.documentElement.lang).toBe(FrontendLocales.EnUs));
  });

  test("keeps placeholder contracts identical across locale catalogs", () => {
    for (const key of Object.keys(zhCnMessages)) {
      expect(readPlaceholders(enUsMessages[key]), key).toEqual(readPlaceholders(zhCnMessages[key]));
    }
  });
});

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function createStorageEventTarget() {
  const listeners = new Set();
  return {
    window: {
      addEventListener(type, listener) {
        if (type === "storage") listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === "storage") listeners.delete(listener);
      },
    },
    dispatch(key) {
      for (const listener of listeners) listener({ key });
    },
  };
}

function readPlaceholders(message) {
  return [...message.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();
}
