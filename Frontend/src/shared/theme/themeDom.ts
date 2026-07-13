import type { MotionLevel } from "../motion";
import type { AppearanceSnapshot } from "./themeModel";

type ViewTransitionHandle = {
  finished?: Promise<void>;
};

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => ViewTransitionHandle;
};

export interface AppearanceTransitionOptions {
  motionLevel?: MotionLevel;
  prefersReducedMotion?: boolean;
  viewTransition?: boolean;
}

const fallbackTransitionClassName = "theme-transition-fallback";
const fallbackTransitionMs = 180;
const reducedFallbackTransitionMs = 80;

export function applyAppearanceSnapshotToDocument(
  snapshot: AppearanceSnapshot,
  documentRef: Pick<Document, "documentElement"> | undefined = readBrowserDocument(),
): void {
  const root = documentRef?.documentElement;
  if (!root) return;

  const { dataset, cssVariables } = snapshot.tokens;
  root.dataset.theme = dataset.theme;
  root.dataset.themePreference = dataset.themePreference;
  root.dataset.colorScheme = dataset.colorScheme;
  root.dataset.accentColor = dataset.accentColor;
  root.dataset.fontFamily = dataset.fontFamily;
  root.dataset.fontScale = dataset.fontScale;
  root.style.colorScheme = snapshot.resolvedTheme;

  for (const [key, value] of Object.entries(cssVariables)) {
    root.style.setProperty(key, value);
  }
}

export function runAppearanceTransition(
  apply: () => void,
  options: AppearanceTransitionOptions = {},
  documentRef: Document | undefined = readBrowserDocument(),
): void {
  const root = documentRef?.documentElement;
  if (!documentRef || !root) {
    apply();
    return;
  }

  const reduced = options.prefersReducedMotion || options.motionLevel === "reduced";
  const disabled = options.motionLevel === "none";
  if (disabled) {
    apply();
    return;
  }

  const shouldUseViewTransition = options.viewTransition !== false && !reduced;
  const transitionDocument = documentRef as DocumentWithViewTransition;
  if (shouldUseViewTransition && typeof transitionDocument.startViewTransition === "function") {
    transitionDocument.startViewTransition(apply);
    return;
  }

  const duration = reduced ? reducedFallbackTransitionMs : fallbackTransitionMs;
  root.style.setProperty("--theme-transition-duration", `${duration}ms`);
  root.classList.add(fallbackTransitionClassName);
  apply();
  window.setTimeout(() => {
    root.classList.remove(fallbackTransitionClassName);
    root.style.removeProperty("--theme-transition-duration");
  }, duration + 40);
}

function readBrowserDocument(): Document | undefined {
  return typeof document === "undefined" ? undefined : document;
}
