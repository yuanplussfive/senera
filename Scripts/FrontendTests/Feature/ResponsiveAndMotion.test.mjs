import { expect, test } from "vitest";
import {
  areResponsiveQueryMatchesEqual,
  createResponsiveModeStore,
  deriveResponsiveMode,
  defaultResponsiveQueryMatches,
  responsiveMediaQueries,
} from "../../../Frontend/src/shared/responsive/index.ts";
import {
  readDialogPanelVariants,
  readFocusPanelVariants,
  readTapScale,
} from "../../../Frontend/src/shared/motion/index.ts";

test("responsive mode derives stable layout capabilities from media query matches", () => {
  const desktop = deriveResponsiveMode({
    ...defaultResponsiveQueryMatches,
    tabletUp: true,
    desktopUp: true,
    wideUp: true,
    supportsHover: true,
  });

  expect(desktop.hasPersistentSessionPanel).toBe(true);
  expect(desktop.hasPersistentWorkflowPanel).toBe(true);
  expect(desktop.supportsHover).toBe(true);
  expect(areResponsiveQueryMatchesEqual(defaultResponsiveQueryMatches, defaultResponsiveQueryMatches)).toBe(true);
});

test("responsive store subscribes to matchMedia and updates snapshots", () => {
  const registry = new Map();
  const store = createResponsiveModeStore(() => (query) => {
    const media = registry.get(query) ?? createMediaQueryList(query, false);
    registry.set(query, media);
    return media;
  });
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  expect(store.getSnapshot().hasPersistentSessionPanel).toBe(false);
  registry.get(responsiveMediaQueries.tabletUp).setMatches(true);
  registry.get(responsiveMediaQueries.desktopUp).setMatches(true);
  registry.get(responsiveMediaQueries.wideUp).setMatches(true);
  expect(notifications >= 3).toBe(true);
  expect(store.getSnapshot().hasPersistentSessionPanel).toBe(true);

  unsubscribe();
  registry.get(responsiveMediaQueries.desktopUp).setMatches(false);
  expect(store.getSnapshot().hasPersistentSessionPanel).toBe(true);
});

test("motion presets expose deterministic reduced-motion variants", () => {
  expect(readTapScale("none")).toBe(undefined);
  expect(readTapScale("full")).toBeLessThan(1);
  expect(readDialogPanelVariants("none").hidden).toEqual({ opacity: 0 });
  expect(readFocusPanelVariants("reduced").hidden).toEqual({ opacity: 0 });
});

function createMediaQueryList(media, matches) {
  const listeners = new Set();
  return {
    media,
    matches,
    onchange: null,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    addListener: (listener) => {
      listeners.add(listener);
    },
    removeListener: (listener) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => true,
    setMatches(next) {
      this.matches = next;
      const event = { matches: next, media };
      listeners.forEach((listener) => listener(event));
    },
  };
}
