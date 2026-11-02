// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  normalizeMobileServerUrl,
  parseDevicePairingCode,
  deviceAuthenticationRequest,
  DeviceAuthenticationError,
  deviceConnectionFailure,
} from "../../../Frontend/src/api/deviceAuthenticationClient.ts";
afterEach(() => vi.unstubAllGlobals());

describe("mobile server connections", () => {
  test("canonicalizes HTTPS and explicit private IPv4 HTTP origins, rejects public plaintext and credentials", () => {
    expect(normalizeMobileServerUrl(" https://COMPUTER.test:443/ ")).toBe("https://computer.test");
    expect(normalizeMobileServerUrl("http://192.168.1.2:5140")).toBe("http://192.168.1.2:5140");
    for (const value of [
      "http://computer.test",
      "https://user:password@computer.test",
      "https://computer.test/path",
      "https://computer.test?token=secret",
      "https://computer.test/#secret",
      "file:///tmp",
      "http://8.8.8.8",
      "http://localhost:5140",
      "http://172.32.1.2",
      "https://127.0.0.1",
    ])
      expect(() => normalizeMobileServerUrl(value)).toThrow();
  });
  test("uses observed native failures for actionable error messages without inventing a definite network cause", () => {
    expect(deviceConnectionFailure(Object.assign(new Error("native error"), { code: "dns_failed" }))).toContain("DNS");
    expect(deviceConnectionFailure(Object.assign(new Error("native error"), { code: "connection_timeout" }))).toContain(
      "连接超时",
    );
    expect(deviceConnectionFailure(Object.assign(new Error("native error"), { code: "tls_failed" }))).toContain("证书");
  });
  test("recognizes the pairing protocol without accepting URL-based credentials or unsupported versions", () => {
    const code = { version: 1, serverUrl: "https://computer.test", pairingId: "i".repeat(32), code: "s".repeat(43) };
    expect(parseDevicePairingCode(JSON.stringify(code))).toEqual(code);
    for (const value of [
      { ...code, version: 2 },
      { ...code, code: "short" },
      { ...code, serverUrl: "https://attacker:secret@computer.test" },
      null,
      "https://computer.test",
    ])
      expect(() => parseDevicePairingCode(JSON.stringify(value))).toThrow();
  });
  test("puts pairing secrets in POST bodies, includes cookies, and retains CSRF authorization", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, state: "pending" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await deviceAuthenticationRequest("https://computer.test", "/api/auth/devices/pairings/exchange", {
      method: "POST",
      body: { secret: "secret" },
      csrfToken: "csrf",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://computer.test/api/auth/devices/pairings/exchange",
      expect.objectContaining({
        credentials: "include",
        body: JSON.stringify({ secret: "secret" }),
        headers: expect.objectContaining({ "X-Senera-Csrf": "csrf" }),
      }),
    );
  });
  test("does not expose server response details as a login message", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ok: false, error: { code: "pairing_unavailable", message: "sensitive internal detail" } }),
            { status: 404 },
          ),
        ),
    );
    await expect(
      deviceAuthenticationRequest("https://computer.test", "/api/auth/devices/pairings/exchange"),
    ).rejects.toBeInstanceOf(DeviceAuthenticationError);
  });
});
