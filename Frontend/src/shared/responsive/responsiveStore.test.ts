import { describe, expect, it, vi } from "vitest";
import { responsiveMediaQueries } from "./responsiveMode";
import { createResponsiveModeStore } from "./responsiveStore";

type Listener = (event: MediaQueryListEvent) => void;

interface FakeMediaQueryList extends MediaQueryList {
  emit: () => void;
  listenerCount: () => number;
  setMatches: (matches: boolean) => void;
}

function createMatchMediaMock(initialMatches: Record<string, boolean>) {
  const lists = new Map<string, FakeMediaQueryList>();
  const matchMedia = vi.fn((query: string): MediaQueryList => {
    const existing = lists.get(query);
    if (existing) return existing;

    const listeners = new Set<Listener>();
    let matches = initialMatches[query] ?? false;
    const media = {
      media: query,
      get matches() {
        return matches;
      },
      onchange: null,
      addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener as Listener);
      }),
      removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.delete(listener as Listener);
      }),
      addListener: vi.fn((listener: Listener) => {
        listeners.add(listener);
      }),
      removeListener: vi.fn((listener: Listener) => {
        listeners.delete(listener);
      }),
      dispatchEvent: vi.fn(() => true),
      emit: () => {
        listeners.forEach((listener) => listener({ matches, media: query } as MediaQueryListEvent));
      },
      listenerCount: () => listeners.size,
      setMatches: (nextMatches: boolean) => {
        matches = nextMatches;
      },
    } as FakeMediaQueryList;

    lists.set(query, media);
    return media;
  });

  return { lists, matchMedia };
}

describe("createResponsiveModeStore", () => {
  it("shares one media subscription set across multiple subscribers", () => {
    const { lists, matchMedia } = createMatchMediaMock({
      [responsiveMediaQueries.tabletUp]: true,
    });
    const store = createResponsiveModeStore(() => matchMedia);
    const subscriberA = vi.fn();
    const subscriberB = vi.fn();

    const unsubscribeA = store.subscribe(subscriberA);
    const callsAfterFirstSubscribe = matchMedia.mock.calls.length;
    const unsubscribeB = store.subscribe(subscriberB);

    expect(matchMedia.mock.calls.length).toBe(callsAfterFirstSubscribe);
    for (const media of lists.values()) {
      expect(media.listenerCount()).toBe(1);
    }

    lists.get(responsiveMediaQueries.desktopUp)?.setMatches(true);
    lists.get(responsiveMediaQueries.desktopUp)?.emit();

    expect(store.getSnapshot()).toMatchObject({ viewport: "desktop", hasPersistentWorkflowPanel: true });
    expect(subscriberA).toHaveBeenCalledTimes(1);
    expect(subscriberB).toHaveBeenCalledTimes(1);

    unsubscribeA();
    for (const media of lists.values()) {
      expect(media.listenerCount()).toBe(1);
    }

    unsubscribeB();
    for (const media of lists.values()) {
      expect(media.listenerCount()).toBe(0);
    }
  });

  it("does not notify subscribers when a media event leaves the derived snapshot unchanged", () => {
    const { lists, matchMedia } = createMatchMediaMock({
      [responsiveMediaQueries.tabletUp]: true,
    });
    const store = createResponsiveModeStore(() => matchMedia);
    const subscriber = vi.fn();

    const unsubscribe = store.subscribe(subscriber);

    lists.get(responsiveMediaQueries.tabletUp)?.emit();

    expect(subscriber).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("falls back to the mobile snapshot without window matchMedia", () => {
    const store = createResponsiveModeStore(() => undefined);

    expect(store.getSnapshot()).toMatchObject({
      viewport: "mobile",
      prefersDrawerNavigation: true,
      prefersCompactControls: true,
    });
  });
});
