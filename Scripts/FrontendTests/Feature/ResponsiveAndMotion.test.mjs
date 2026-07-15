import { expect, test } from "vitest";
import {
  areResponsiveQueryMatchesEqual,
  classifyModelServiceLayout,
  createModelServiceLayoutStore,
  createResponsiveModeStore,
  deriveResponsiveMode,
  defaultResponsiveQueryMatches,
  modelServiceMediaQueries,
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
  const compactDesktop = deriveResponsiveMode({
    ...defaultResponsiveQueryMatches,
    tabletUp: true,
    desktopUp: true,
  });
  expect(compactDesktop.viewport).toBe("desktop");
  expect(compactDesktop.hasPersistentSessionPanel).toBe(true);
  expect(compactDesktop.hasPersistentWorkflowPanel).toBe(true);
  expect(compactDesktop.hasInlineWorkflowPanel).toBe(false);
  const inlineDesktop = deriveResponsiveMode({
    ...defaultResponsiveQueryMatches,
    tabletUp: true,
    desktopUp: true,
    workflowInlineUp: true,
  });
  expect(inlineDesktop.viewport).toBe("desktop");
  expect(inlineDesktop.hasInlineWorkflowPanel).toBe(true);
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

test("model service layout classifies each responsive boundary", () => {
  expect(classifyModelServiceLayout(899)).toBe("mobile");
  expect(classifyModelServiceLayout(900)).toBe("tablet");
  expect(classifyModelServiceLayout(1199)).toBe("tablet");
  expect(classifyModelServiceLayout(1200)).toBe("desktop");
});

test("model service layout store has a mobile SSR default without matchMedia", () => {
  const store = createModelServiceLayoutStore(() => undefined);

  expect(store.getSnapshot()).toBe("mobile");
  expect(store.getServerSnapshot()).toBe("mobile");

  const unsubscribe = store.subscribe(() => undefined);
  unsubscribe();
});

test("model service layout store attaches media listeners once and detaches them with its last subscriber", () => {
  const registry = new Map();
  const listenerCounts = { added: 0, removed: 0 };
  const store = createModelServiceLayoutStore(() => (query) => {
    const media = registry.get(query) ?? createMediaQueryList(query, false, listenerCounts);
    registry.set(query, media);
    return media;
  });
  let notifications = 0;

  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });
  const unsubscribeSecond = store.subscribe(() => undefined);

  expect(listenerCounts.added).toBe(Object.keys(modelServiceMediaQueries).length);
  registry.get(modelServiceMediaQueries.tabletUp).setMatches(true);
  expect(store.getSnapshot()).toBe("tablet");
  registry.get(modelServiceMediaQueries.desktopUp).setMatches(true);
  expect(store.getSnapshot()).toBe("desktop");
  expect(notifications).toBe(2);

  unsubscribe();

  expect(listenerCounts.removed).toBe(0);

  unsubscribeSecond();

  expect(listenerCounts.removed).toBe(Object.keys(modelServiceMediaQueries).length);
});

test("motion presets expose deterministic reduced-motion variants", () => {
  expect(readTapScale("none")).toBe(undefined);
  expect(readTapScale("full")).toBeLessThan(1);
  expect(readDialogPanelVariants("none").hidden).toEqual({ opacity: 0 });
  expect(readFocusPanelVariants("reduced").hidden).toEqual({ opacity: 0 });
});

function createMediaQueryList(media, matches, listenerCounts) {
  const listeners = new Set();
  return {
    media,
    matches,
    onchange: null,
    addEventListener: (_type, listener) => {
      if (listenerCounts) listenerCounts.added += 1;
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      if (listenerCounts) listenerCounts.removed += 1;
      listeners.delete(listener);
    },
    addListener: (listener) => {
      if (listenerCounts) listenerCounts.added += 1;
      listeners.add(listener);
    },
    removeListener: (listener) => {
      if (listenerCounts) listenerCounts.removed += 1;
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
