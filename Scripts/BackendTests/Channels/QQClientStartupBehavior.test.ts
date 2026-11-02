// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { createApp, h, type App } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { useKeyboard } from "../../../Frontend/qq/client/src/renderer/src/function/utils/useDomEvents.js";
import {
  readNotificationPermission,
  requestNotificationPermission,
} from "../../../Frontend/qq/client/src/renderer/src/runtime/notifications.js";

const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

test("notification status reads never request permission; only a user request opens the prompt", async () => {
  const requestPermission = vi.fn(async () => "granted");
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  expect(readNotificationPermission()).toBe("default");
  expect(requestPermission).not.toHaveBeenCalled();
  expect(await requestNotificationPermission()).toBe("granted");
  expect(requestPermission).toHaveBeenCalledTimes(1);
});

test("notification settings report unsupported environments without invoking a prompt", async () => {
  const requestPermission = vi.fn();
  vi.stubGlobal("Notification", { permission: "granted", requestPermission });
  vi.stubGlobal("isSecureContext", false);
  expect(readNotificationPermission()).toBe("unsupported");
  expect(await requestNotificationPermission()).toBe("unsupported");
  expect(requestPermission).not.toHaveBeenCalled();
});

test.each(["Frontend/qq/index.html"])(
  "%s declares a device-width layout without restricting accessible browser zoom",
  (entry) => {
    const html = fs.readFileSync(path.resolve(entry), "utf8");
    const root = new DOMParser().parseFromString(html, "text/html");
    const viewport = root.querySelector<HTMLMetaElement>('meta[name="viewport"]')!;
    expect(viewport.content).toContain("width=device-width");
    expect(Number(/initial-scale=([\d.]+)/u.exec(viewport.content)![1])).toBe(1);
    expect(viewport.content.match(/initial-scale=/gu)).toHaveLength(1);
    expect(viewport.content).not.toMatch(/user-scalable=no|maximum-scale=/u);
    expect(root.querySelector('meta[name="theme-color"]')).not.toBeNull();
  },
);

test("ignores keydown events without keyboard data, composition and consumed input", () => {
  const callback = vi.fn(() => true);
  mountKeyboard(["a"], callback);
  const errors: ErrorEvent[] = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event);
  };
  window.addEventListener("error", onError);
  try {
    document.dispatchEvent(new Event("keydown"));
    document.dispatchEvent(new KeyboardEvent("keydown"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", isComposing: true }));
    const consumed = new KeyboardEvent("keydown", { key: "a", cancelable: true });
    consumed.preventDefault();
    document.dispatchEvent(consumed);
    expect(callback).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  } finally {
    window.removeEventListener("error", onError);
  }
});

test("matches shortcut alternatives and modifiers, then removes its listeners on unmount", () => {
  const callback = vi.fn(() => true);
  const app = mountKeyboard(["ctrl+s", "ArrowRight"], callback);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
  expect(callback).not.toHaveBeenCalled();
  const save = new KeyboardEvent("keydown", { key: "S", ctrlKey: true, cancelable: true });
  document.dispatchEvent(save);
  expect(callback).toHaveBeenCalledTimes(1);
  expect(save.defaultPrevented).toBe(true);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  expect(callback).toHaveBeenCalledTimes(2);
  app.unmount();
  apps.splice(apps.indexOf(app), 1);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  expect(callback).toHaveBeenCalledTimes(2);
});

function mountKeyboard(keys: [string, ...string[]], callback: () => boolean): App {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const app = createApp({
    setup() {
      useKeyboard(...keys, callback);
      return () => h("div");
    },
  });
  app.mount(target);
  apps.push(app);
  return app;
}
