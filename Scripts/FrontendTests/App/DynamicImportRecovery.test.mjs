import { afterEach, describe, expect, it, vi } from "vitest";
import { installViteDynamicImportRecovery } from "../../../Frontend/src/app/viteDynamicImportRecovery.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function createWindow(sessionStorage) {
  const target = Object.assign(new EventTarget(), { sessionStorage, location: { reload: vi.fn() } });
  vi.stubGlobal("window", target);
  return target;
}

function failPreload(target, message) {
  const event = new Event("vite:preloadError", { cancelable: true });
  event.payload = new Error(message);
  target.dispatchEvent(event);
  return event;
}

describe("deployment resource recovery", () => {
  it("reloads only once for the deployment even when different assets fail across document loads", () => {
    vi.stubEnv("DEV", false);
    const values = new Map();
    const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
    const first = createWindow(storage);
    installViteDynamicImportRecovery();
    expect(failPreload(first, "missing font CSS").defaultPrevented).toBe(true);
    expect(first.location.reload).toHaveBeenCalledOnce();

    const reloaded = createWindow(storage);
    installViteDynamicImportRecovery();
    expect(failPreload(reloaded, "missing editor CSS").defaultPrevented).toBe(false);
    expect(failPreload(reloaded, "missing tool chunk").defaultPrevented).toBe(false);
    expect(reloaded.location.reload).not.toHaveBeenCalled();
  });

  it("leaves the error visible when browser storage cannot guard a reload", () => {
    vi.stubEnv("DEV", false);
    const target = createWindow({
      getItem: () => {
        throw new Error("storage disabled");
      },
    });
    installViteDynamicImportRecovery();
    expect(failPreload(target, "missing chunk").defaultPrevented).toBe(false);
    expect(target.location.reload).not.toHaveBeenCalled();
  });
});
