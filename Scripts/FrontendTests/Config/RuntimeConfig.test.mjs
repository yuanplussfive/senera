// @vitest-environment jsdom

import { afterEach, describe, expect, test } from "vitest";
import { resolveRuntimeHttpBaseUrl, resolveRuntimeWebSocketUrl } from "../../../Frontend/src/config/runtimeConfig.ts";

afterEach(() => {
  window.__SENERA_RUNTIME_CONFIG__ = {};
});

describe("frontend runtime endpoints", () => {
  test("uses the page origin when a production build has no endpoint override", () => {
    window.__SENERA_RUNTIME_CONFIG__ = {};

    const pageUrl = new URL(window.location.href);
    pageUrl.protocol = pageUrl.protocol === "https:" ? "wss:" : "ws:";
    pageUrl.pathname = "/";
    pageUrl.search = "";
    pageUrl.hash = "";

    expect(resolveRuntimeWebSocketUrl("")).toBe(pageUrl.toString());
    expect(resolveRuntimeHttpBaseUrl(resolveRuntimeWebSocketUrl(""))).toBe(window.location.origin);
  });

  test("keeps Docker HTTP APIs on the page origin independently of the WebSocket endpoint", () => {
    window.__SENERA_RUNTIME_CONFIG__ = {
      webSocketUrl: "ws://127.0.0.1:8787",
      httpBaseUrl: "",
    };

    const webSocketUrl = resolveRuntimeWebSocketUrl("ws://build.example.invalid");
    expect(webSocketUrl).toBe("ws://127.0.0.1:8787");
    expect(resolveRuntimeHttpBaseUrl(webSocketUrl)).toBe(window.location.origin);
  });

  test("derives the HTTP endpoint from WebSocket configuration for split development runtimes", () => {
    window.__SENERA_RUNTIME_CONFIG__ = {};

    expect(resolveRuntimeHttpBaseUrl("wss://agent.example.test/socket")).toBe("https://agent.example.test");
  });

  test("accepts an explicit HTTP runtime endpoint without retaining credentials or paths", () => {
    window.__SENERA_RUNTIME_CONFIG__ = {
      httpBaseUrl: "https://user:password@agent.example.test/internal?token=secret#fragment",
    };

    expect(resolveRuntimeHttpBaseUrl("ws://unused.example.test")).toBe("https://agent.example.test");
  });
});
