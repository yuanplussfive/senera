import { afterEach, expect, test, vi } from "vitest";
import { ClientConnectionLifecycle } from "../../../Frontend/src/api/connectionLifecycle.ts";
import { readAgentOneBot11ClientRoute } from "../../../Source/AgentSystem/Channels/AgentChannelClientRoutes.ts";
import { installAgentQqClientDocumentContext } from "../../../Source/AgentSystem/Channels/Client/AgentQqClientDocumentContext.ts";
import {
  parseAgentQqClientPreferences,
  readAgentQqClientPreferencesKey,
  serializeAgentQqClientPreferences,
} from "../../../Source/AgentSystem/Channels/Client/AgentQqClientPreferences.ts";
import {
  ensurePinyinLoaded,
  getPinyin,
  matchPinyin,
} from "../../../Frontend/qq/client/src/renderer/src/function/utils/pinyin.ts";

const lifecycles = [];
afterEach(() => {
  for (const lifecycle of lifecycles.splice(0)) lifecycle.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.head.replaceChildren();
  localStorage.clear();
});

test("backgrounding cancels retries; foreground resume restores once and stop removes listeners", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const callbacks = { suspend: vi.fn(), resume: vi.fn() };
  const lifecycle = new ClientConnectionLifecycle(callbacks);
  lifecycles.push(lifecycle);
  lifecycle.start();
  lifecycle.start();
  const connect = vi.fn();
  lifecycle.reconnect(connect);
  window.dispatchEvent(new Event("senera:pause"));
  expect(lifecycle.paused).toBe(true);
  expect(callbacks.suspend).toHaveBeenCalledTimes(1);
  lifecycle.reconnect(connect);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(connect).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("senera:resume"));
  expect(callbacks.resume).toHaveBeenCalledTimes(1);
  expect(lifecycle.paused).toBe(false);
  lifecycle.stop();
  window.dispatchEvent(new Event("senera:pause"));
  window.dispatchEvent(new Event("pageshow"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(callbacks.suspend).toHaveBeenCalledTimes(1);
  expect(callbacks.resume).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("retries have a single timer and successful authentication resets backoff", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(Math, "random").mockReturnValue(0);
  const lifecycle = new ClientConnectionLifecycle({ suspend() {}, resume() {} });
  lifecycles.push(lifecycle);
  lifecycle.start();
  const replaced = vi.fn();
  const connect = vi.fn();
  lifecycle.reconnect(replaced);
  lifecycle.reconnect(connect);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(replaced).not.toHaveBeenCalled();
  expect(connect).toHaveBeenCalledTimes(1);
  lifecycle.connected();
  lifecycle.reconnect(connect);
  await vi.advanceTimersByTimeAsync(500);
  expect(connect).toHaveBeenCalledTimes(2);
});

test("host and client preserve encoded settings in separate workspace namespaces", () => {
  expect(() => readAgentQqClientPreferencesKey()).toThrow("workspace-scoped");
  const meta = document.createElement("meta");
  meta.name = "senera-qq-options-key";
  meta.content = "stapxs:options:workspace-a";
  document.head.append(meta);
  const options = {
    auto_connect: "false",
    background: encodeURIComponent("senera://resource/a1b2c3"),
    note: "value:with:colons",
  };
  localStorage.setItem(readAgentQqClientPreferencesKey(), serializeAgentQqClientPreferences(options));
  meta.content = "stapxs:options:workspace-b";
  expect(parseAgentQqClientPreferences(localStorage.getItem(readAgentQqClientPreferencesKey()))).toEqual({});
  meta.content = "stapxs:options:workspace-a";
  expect(parseAgentQqClientPreferences(localStorage.getItem(readAgentQqClientPreferencesKey()))).toEqual(options);
  const special = parseAgentQqClientPreferences("__proto__:literal&constructor:literal");
  expect(Object.getPrototypeOf(special)).toBeNull();
  expect(special.__proto__).toBe("literal");
});

test("packaged QQ installs the same workspace context without server HTML injection", () => {
  const workspaceId = "aab4aabe-30c1-4fa3-a0e7-5327c1fac2e0";
  const root = `/api/channel-clients/onebot11/${workspaceId}/`;
  const route = readAgentOneBot11ClientRoute(root);
  installAgentQqClientDocumentContext(document, route);
  expect(readAgentQqClientPreferencesKey()).toBe(`stapxs:options:${workspaceId}`);
  expect(document.querySelector('meta[name="senera-client-root"]').content).toBe(root);
  expect(document.querySelector('meta[name="senera-time-zone"]').content).toBe("Asia/Shanghai");
  expect(document.querySelector('meta[name="senera-console-path"]').content).toBe("/");
  expect(document.querySelector('link[rel="license"]').getAttribute("href")).toBe(`${root}source.tar.gz`);
  document.querySelector('meta[name="senera-console-path"]').content = "/development/";
  installAgentQqClientDocumentContext(document, route);
  expect(document.querySelectorAll('meta[name="senera-client-root"]')).toHaveLength(1);
  expect(document.querySelector('meta[name="senera-console-path"]').content).toBe("/development/");
});

test("the installed pinyin module supports names, initials and polyphonic searches", async () => {
  expect(await ensurePinyinLoaded()).toBe(true);
  const data = getPinyin("重庆好友");
  expect(matchPinyin(data, "chongqing")).toBe(true);
  expect(matchPinyin(data, "CQHY")).toBe(true);
  expect(matchPinyin(data, "unknown")).toBe(false);
});
