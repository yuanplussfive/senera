import type { MotionLevel } from "../motion/types";
import {
  appearancePreferenceStorageKey,
  areAppearanceSnapshotsEqual,
  createAppearanceSnapshot,
  defaultAppearancePreference,
  normalizeAppearancePreference,
  readStoredAppearancePreference,
  readSystemTheme,
  readFontScaleValue,
  readFontScaleAnchor,
  normalizeFontScaleValue,
  type AppearancePreference,
  type AppearancePreferenceUpdate,
  type AppearanceSnapshot,
} from "./themeModel";
import {
  applyAppearanceSnapshotToDocument,
  applyFontScalePreviewToDocument,
  runAppearanceTransition,
} from "./themeDom";

type AppearanceListener = () => void;
type MediaChangeListener = (event: MediaQueryListEvent) => void;
type StorageChangeListener = (event: StorageEvent) => void;

export type MatchMediaReader = () => Pick<Window, "matchMedia">["matchMedia"] | undefined;
export type StorageReader = () => Storage | undefined;
export type WindowReader = () => Pick<Window, "addEventListener" | "removeEventListener"> | undefined;

interface MediaSubscription {
  media: MediaQueryList;
  listener: MediaChangeListener;
}

export interface AppearanceStore {
  getSnapshot: () => AppearanceSnapshot;
  getServerSnapshot: () => AppearanceSnapshot;
  subscribe: (listener: AppearanceListener) => () => void;
  setPreference: (preference: AppearancePreferenceUpdate) => void;
  previewFontScale: (value: number) => void;
  commitFontScale: (value: number) => void;
  setMotionLevel: (motionLevel: MotionLevel, prefersReducedMotion?: boolean) => void;
}

export function createAppearanceStore({
  readMatchMedia = readBrowserMatchMedia,
  readStorage = readBrowserStorage,
  readWindow = readBrowserWindow,
}: {
  readMatchMedia?: MatchMediaReader;
  readStorage?: StorageReader;
  readWindow?: WindowReader;
} = {}): AppearanceStore {
  let subscribers = new Set<AppearanceListener>();
  let mediaSubscription: MediaSubscription | null = null;
  let storageListener: StorageChangeListener | null = null;
  let motionLevel: MotionLevel = "full";
  let prefersReducedMotion = false;
  let fontScalePreview: number | undefined;
  let fontScalePreviewFrame: number | null = null;

  let currentSnapshot = createAppearanceSnapshot({
    preference: readStorageAppearancePreference(readStorage()),
    systemTheme: readSystemTheme(readMatchMedia()),
  });
  const serverSnapshot = createAppearanceSnapshot({
    preference: defaultAppearancePreference,
    systemTheme: "light",
  });

  const notify = (): void => {
    subscribers.forEach((subscriber) => subscriber());
  };

  const updateSnapshot = (
    nextSnapshot: AppearanceSnapshot,
    { persist = false, animate = false }: { persist?: boolean; animate?: boolean } = {},
  ): void => {
    if (persist) writeStoredAppearancePreference(readStorage(), nextSnapshot.preference);
    if (areAppearanceSnapshotsEqual(currentSnapshot, nextSnapshot)) return;

    const apply = (): void => {
      currentSnapshot = nextSnapshot;
      applyAppearanceSnapshotToDocument(nextSnapshot);
      if (fontScalePreview !== undefined) applyFontScalePreviewToDocument(fontScalePreview);
      notify();
    };

    if (animate) {
      runAppearanceTransition(apply, { motionLevel, prefersReducedMotion });
      return;
    }

    apply();
  };

  const refreshSystemTheme = (): void => {
    const nextSystemTheme = readSystemTheme(readMatchMedia());
    updateSnapshot(
      createAppearanceSnapshot({
        preference: currentSnapshot.preference,
        systemTheme: nextSystemTheme,
      }),
      {
        animate: currentSnapshot.preference.themeMode === "system",
      },
    );
  };

  const refreshStoredPreference = (): void => {
    discardFontScalePreview();
    const nextPreference = readStorageAppearancePreference(readStorage());
    updateSnapshot(
      createAppearanceSnapshot({
        preference: nextPreference,
        systemTheme: currentSnapshot.systemTheme,
      }),
      {
        animate: true,
      },
    );
  };

  const startListening = (): void => {
    const matchMedia = readMatchMedia();
    if (matchMedia && !mediaSubscription) {
      const media = matchMedia("(prefers-color-scheme: dark)");
      const listener: MediaChangeListener = () => refreshSystemTheme();
      addMediaListener(media, listener);
      mediaSubscription = { media, listener };
    }

    const windowRef = readWindow();
    if (windowRef && !storageListener) {
      storageListener = (event) => {
        if (event.key === appearancePreferenceStorageKey) refreshStoredPreference();
      };
      windowRef.addEventListener("storage", storageListener);
    }

    updateSnapshot(
      createAppearanceSnapshot({
        preference: readStorageAppearancePreference(readStorage()),
        systemTheme: readSystemTheme(readMatchMedia()),
      }),
    );
  };

  const stopListening = (): void => {
    discardFontScalePreview();
    if (mediaSubscription) {
      removeMediaListener(mediaSubscription.media, mediaSubscription.listener);
      mediaSubscription = null;
    }
    const windowRef = readWindow();
    if (windowRef && storageListener) {
      windowRef.removeEventListener("storage", storageListener);
      storageListener = null;
    }
  };

  const flushFontScalePreview = (): void => {
    fontScalePreviewFrame = null;
    if (fontScalePreview !== undefined) applyFontScalePreviewToDocument(fontScalePreview);
  };

  const scheduleFontScalePreview = (): void => {
    if (fontScalePreviewFrame !== null) return;
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      flushFontScalePreview();
      return;
    }
    fontScalePreviewFrame = window.requestAnimationFrame(flushFontScalePreview);
  };

  const discardFontScalePreview = (): void => {
    const hadPreview = fontScalePreview !== undefined;
    if (
      fontScalePreviewFrame !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(fontScalePreviewFrame);
    }
    fontScalePreviewFrame = null;
    fontScalePreview = undefined;
    if (hadPreview) applyFontScalePreviewToDocument(readFontScaleValue(currentSnapshot.preference));
  };

  const setPreference = (preference: AppearancePreferenceUpdate): void => {
    if ("fontScale" in preference || "fontScaleValue" in preference) discardFontScalePreview();
    const nextPreference = normalizeAppearancePreference({
      ...currentSnapshot.preference,
      ...preference,
    });
    const fontScaleChanged = readFontScaleValue(currentSnapshot.preference) !== readFontScaleValue(nextPreference);
    updateSnapshot(
      createAppearanceSnapshot({
        preference: nextPreference,
        systemTheme: currentSnapshot.systemTheme,
      }),
      {
        // A range preview updates the font variable directly. Committing it
        // must not start a document-wide view transition.
        animate: !fontScaleChanged,
        persist: true,
      },
    );
  };

  applyAppearanceSnapshotToDocument(currentSnapshot);

  return {
    getSnapshot: () => currentSnapshot,
    getServerSnapshot: () => serverSnapshot,
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
    setPreference,
    previewFontScale: (value) => {
      const normalized = normalizeFontScaleValue(value);
      if (normalized === undefined || fontScalePreview === normalized) return;
      fontScalePreview = normalized;
      scheduleFontScalePreview();
    },
    commitFontScale: (value) => {
      const normalized = normalizeFontScaleValue(value);
      if (normalized === undefined) return;
      discardFontScalePreview();
      setPreference({ fontScaleValue: normalized, fontScale: readFontScaleAnchor(normalized) });
    },
    setMotionLevel: (nextMotionLevel, nextPrefersReducedMotion = prefersReducedMotion) => {
      motionLevel = nextMotionLevel;
      prefersReducedMotion = nextPrefersReducedMotion;
    },
  };
}

function readStorageAppearancePreference(storage: Storage | undefined): AppearancePreference {
  if (!storage) return defaultAppearancePreference;
  return readStoredAppearancePreference((key) => storage.getItem(key));
}

function writeStoredAppearancePreference(storage: Storage | undefined, preference: AppearancePreference): void {
  if (!storage) return;
  try {
    storage.setItem(appearancePreferenceStorageKey, JSON.stringify(preference));
  } catch {
    // Persistence is best-effort; DOM appearance state still updates.
  }
}

function readBrowserMatchMedia(): Pick<Window, "matchMedia">["matchMedia"] | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
  return window.matchMedia.bind(window);
}

function readBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}

function readBrowserWindow(): Pick<Window, "addEventListener" | "removeEventListener"> | undefined {
  return typeof window === "undefined" ? undefined : window;
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
