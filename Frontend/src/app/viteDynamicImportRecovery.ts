const VITE_PRELOAD_ERROR_EVENT = "vite:preloadError";
const retryStoragePrefix = "senera.vite-preload-retry:";
const installationKey = "__seneraVitePreloadRecoveryInstalled";

interface VitePreloadErrorEvent extends Event {
  readonly payload?: unknown;
}

interface RecoveryWindow extends Window {
  [installationKey]?: true;
}

/**
 * Handles the deployment race documented by Vite: an older page can request a
 * hash-named dynamic chunk that a newer deployment has already removed. The
 * only valid recovery is to load the current HTML entry, not to import an
 * internal build artifact by a reconstructed URL.
 */
export function installViteDynamicImportRecovery(): void {
  if (import.meta.env.DEV || typeof window === "undefined") return;

  const target = window as RecoveryWindow;
  if (target[installationKey]) return;
  target[installationKey] = true;
  window.addEventListener(VITE_PRELOAD_ERROR_EVENT, reloadForCurrentDeployment);
}

function reloadForCurrentDeployment(event: Event): void {
  const preloadError = event as VitePreloadErrorEvent;
  const storageKey = `${retryStoragePrefix}${window.location.pathname}${window.location.search}`;
  const signature = readErrorSignature(preloadError.payload);

  try {
    if (window.sessionStorage.getItem(storageKey) === signature) return;
    window.sessionStorage.setItem(storageKey, signature);
  } catch {
    // Without a per-tab guard a persistent 404 could trap the user in reloads.
    return;
  }

  event.preventDefault();
  window.location.reload();
}

function readErrorSignature(payload: unknown): string {
  if (payload instanceof Error) return `${payload.name}:${payload.message}`;
  return String(payload);
}
