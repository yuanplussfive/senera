import { useSyncExternalStore } from "react";
import type { MatchMediaReader } from "./responsiveStore";

export type ModelServiceLayout = "mobile" | "tablet" | "desktop";

interface ModelServiceLayoutMatches {
  tabletUp: boolean;
  desktopUp: boolean;
}

type LayoutListener = () => void;
type MediaChangeListener = (event: MediaQueryListEvent) => void;

export const modelServiceMediaQueries = {
  tabletUp: "(min-width: 900px)",
  desktopUp: "(min-width: 1200px)",
} as const satisfies Record<keyof ModelServiceLayoutMatches, string>;

interface MediaSubscription {
  media: MediaQueryList;
  listener: MediaChangeListener;
}

export interface ModelServiceLayoutStore {
  getSnapshot: () => ModelServiceLayout;
  getServerSnapshot: () => ModelServiceLayout;
  subscribe: (listener: LayoutListener) => () => void;
}

export function classifyModelServiceLayout(width: number): ModelServiceLayout {
  if (width >= 1200) return "desktop";
  if (width >= 900) return "tablet";
  return "mobile";
}

export function createModelServiceLayoutStore(
  readMatchMedia: MatchMediaReader = readBrowserMatchMedia,
): ModelServiceLayoutStore {
  let subscribers = new Set<LayoutListener>();
  let mediaSubscriptions: MediaSubscription[] = [];
  let currentMatches = readLayoutMatches(readMatchMedia());
  let currentSnapshot = deriveLayout(currentMatches);

  const refreshSnapshot = (): boolean => {
    const nextMatches = readLayoutMatches(readMatchMedia());
    if (areMatchesEqual(currentMatches, nextMatches)) {
      return false;
    }
    currentMatches = nextMatches;
    currentSnapshot = deriveLayout(nextMatches);
    return true;
  };

  const notifyIfChanged = (): void => {
    if (!refreshSnapshot()) return;
    subscribers.forEach((subscriber) => subscriber());
  };

  const startListening = (): void => {
    const matchMedia = readMatchMedia();
    if (!matchMedia || mediaSubscriptions.length > 0) return;

    mediaSubscriptions = Object.values(modelServiceMediaQueries).map((query) => {
      const media = matchMedia(query);
      const listener: MediaChangeListener = () => notifyIfChanged();
      addMediaListener(media, listener);
      return { media, listener };
    });
    notifyIfChanged();
  };

  const stopListening = (): void => {
    mediaSubscriptions.forEach(({ media, listener }) => removeMediaListener(media, listener));
    mediaSubscriptions = [];
  };

  return {
    getSnapshot: () => currentSnapshot,
    getServerSnapshot: () => "mobile",
    subscribe: (listener) => {
      subscribers.add(listener);
      if (subscribers.size === 1) {
        startListening();
      }
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0) {
          stopListening();
          subscribers = new Set();
        }
      };
    },
  };
}

const modelServiceLayoutStore = createModelServiceLayoutStore();

export function useModelServiceLayout(): ModelServiceLayout {
  return useSyncExternalStore(
    modelServiceLayoutStore.subscribe,
    modelServiceLayoutStore.getSnapshot,
    modelServiceLayoutStore.getServerSnapshot,
  );
}

function deriveLayout(matches: ModelServiceLayoutMatches): ModelServiceLayout {
  if (matches.desktopUp) return "desktop";
  if (matches.tabletUp) return "tablet";
  return "mobile";
}

function readBrowserMatchMedia(): Pick<Window, "matchMedia">["matchMedia"] | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return undefined;
  }
  return window.matchMedia.bind(window);
}

function readLayoutMatches(
  matchMedia: Pick<Window, "matchMedia">["matchMedia"] | undefined,
): ModelServiceLayoutMatches {
  if (!matchMedia) {
    return { tabletUp: false, desktopUp: false };
  }
  return {
    tabletUp: matchMedia(modelServiceMediaQueries.tabletUp).matches,
    desktopUp: matchMedia(modelServiceMediaQueries.desktopUp).matches,
  };
}

function areMatchesEqual(left: ModelServiceLayoutMatches, right: ModelServiceLayoutMatches): boolean {
  return left.tabletUp === right.tabletUp && left.desktopUp === right.desktopUp;
}

function addMediaListener(media: MediaQueryList, listener: MediaChangeListener): void {
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", listener);
    return;
  }
  media.addListener(listener);
}

function removeMediaListener(media: MediaQueryList, listener: MediaChangeListener): void {
  if (typeof media.removeEventListener === "function") {
    media.removeEventListener("change", listener);
    return;
  }
  media.removeListener(listener);
}
