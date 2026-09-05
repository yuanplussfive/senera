import {
  areResponsiveQueryMatchesEqual,
  defaultResponsiveQueryMatches,
  deriveResponsiveMode,
  responsiveMediaQueries,
  type ResponsiveMode,
  type ResponsiveQueryMatches,
} from "./responsiveMode";

type ResponsiveListener = () => void;
type MediaChangeListener = (event: MediaQueryListEvent) => void;

export type MatchMediaReader = () => Pick<Window, "matchMedia">["matchMedia"] | undefined;

interface MediaSubscription {
  media: MediaQueryList;
  listener: MediaChangeListener;
}

export interface ResponsiveModeStore {
  getSnapshot: () => ResponsiveMode;
  getServerSnapshot: () => ResponsiveMode;
  subscribe: (listener: ResponsiveListener) => () => void;
}

export function createResponsiveModeStore(
  readMatchMedia: MatchMediaReader = readBrowserMatchMedia,
): ResponsiveModeStore {
  let subscribers = new Set<ResponsiveListener>();
  let mediaSubscriptions: MediaSubscription[] = [];
  let currentMatches = readResponsiveQueryMatches(readMatchMedia());
  let currentSnapshot = deriveResponsiveMode(currentMatches);
  const serverSnapshot = deriveResponsiveMode(defaultResponsiveQueryMatches);

  const refreshSnapshot = (): boolean => {
    const nextMatches = readResponsiveQueryMatches(readMatchMedia());
    if (areResponsiveQueryMatchesEqual(currentMatches, nextMatches)) {
      return false;
    }
    currentMatches = nextMatches;
    currentSnapshot = deriveResponsiveMode(nextMatches);
    return true;
  };

  const notifyIfChanged = (): void => {
    if (!refreshSnapshot()) return;
    subscribers.forEach((subscriber) => subscriber());
  };

  const startListening = (): void => {
    const matchMedia = readMatchMedia();
    if (!matchMedia || mediaSubscriptions.length > 0) return;

    mediaSubscriptions = Object.values(responsiveMediaQueries).map((query) => {
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
    getServerSnapshot: () => serverSnapshot,
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

function readBrowserMatchMedia(): Pick<Window, "matchMedia">["matchMedia"] | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return undefined;
  }
  return window.matchMedia.bind(window);
}

function readResponsiveQueryMatches(
  matchMedia: Pick<Window, "matchMedia">["matchMedia"] | undefined,
): ResponsiveQueryMatches {
  if (!matchMedia) {
    return defaultResponsiveQueryMatches;
  }
  return {
    tabletUp: matchMedia(responsiveMediaQueries.tabletUp).matches,
    desktopUp: matchMedia(responsiveMediaQueries.desktopUp).matches,
    wideUp: matchMedia(responsiveMediaQueries.wideUp).matches,
    workflowInlineUp: matchMedia(responsiveMediaQueries.workflowInlineUp).matches,
    supportsHover: matchMedia(responsiveMediaQueries.supportsHover).matches,
    hasPrimaryCoarsePointer: matchMedia(responsiveMediaQueries.hasPrimaryCoarsePointer).matches,
    hasAnyCoarsePointer: matchMedia(responsiveMediaQueries.hasAnyCoarsePointer).matches,
    prefersReducedMotion: matchMedia(responsiveMediaQueries.prefersReducedMotion).matches,
  };
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
