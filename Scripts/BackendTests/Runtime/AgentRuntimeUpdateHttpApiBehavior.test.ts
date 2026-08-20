import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, test, vi } from "vitest";
import { AgentRuntimeUpdateHttpApi } from "../../../Source/AgentSystem/Runtime/AgentRuntimeUpdateHttpApi.js";
import {
  AgentRuntimeUpdateFailureCodes,
  AgentRuntimeUpdateRoute,
} from "../../../Source/AgentSystem/Runtime/AgentRuntimeUpdateContract.js";
import { createAgentRuntimeUpdateOrigin } from "../../../Source/AgentSystem/Runtime/AgentRuntimeUpdateOrigin.js";

describe("runtime update HTTP API", () => {
  test("projects a newer release without exposing the full manifest", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            product: "senera",
            version: "1.3.0",
            tag: "v1.3.0",
            releaseName: "Senera v1.3.0",
            releaseUrl: "https://github.com/example/senera/releases/tag/v1.3.0",
            desktop: {
              installerUrl: "https://github.com/example/senera/releases/download/v1.3.0/SeneraSetup-1.3.0.exe",
              installerSha256: "a".repeat(64),
              installerSize: 42,
              metadataUrl: "https://github.com/example/senera/releases/download/v1.3.0/latest.yml",
              blockmapUrl: "https://github.com/example/senera/releases/download/v1.3.0/SeneraSetup-1.3.0.exe.blockmap",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const api = new AgentRuntimeUpdateHttpApi({
      currentVersion: "1.2.0",
      deployment: "container",
      manifestUrl: "https://updates.example.com/senera-update.json",
      fetch: fetcher,
    });
    const response = responseFixture();

    await api.handle(request("GET", `${AgentRuntimeUpdateRoute}?refresh=1`), response.response);

    expect(response.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Cache-Control": "no-store" }));
    expect(JSON.parse(String(response.end.mock.calls[0]?.[0]))).toEqual({
      schemaVersion: 1,
      currentVersion: "1.2.0",
      deployment: "container",
      status: "available",
      latest: {
        version: "1.3.0",
        tag: "v1.3.0",
        releaseName: "Senera v1.3.0",
        releaseUrl: "https://github.com/example/senera/releases/tag/v1.3.0",
      },
      action: "operator",
      checkedAt: expect.any(String),
    });
  });

  test("caches a valid manifest and reports disabled checks explicitly", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            product: "senera",
            version: "1.2.0",
            tag: "v1.2.0",
            releaseName: "Senera v1.2.0",
            releaseUrl: "https://github.com/example/senera/releases/tag/v1.2.0",
          }),
        ),
    );
    const api = new AgentRuntimeUpdateHttpApi({
      currentVersion: "1.2.0",
      deployment: "local",
      manifestUrl: "https://updates.example.com/senera-update.json",
      fetch: fetcher,
    });
    const first = responseFixture();
    const second = responseFixture();
    await api.handle(request("GET", AgentRuntimeUpdateRoute), first.response);
    await api.handle(request("GET", AgentRuntimeUpdateRoute), second.response);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(second.end.mock.calls[0]?.[0]))).toMatchObject({ status: "up-to-date", action: "none" });

    const disabled = new AgentRuntimeUpdateHttpApi({ currentVersion: "1.2.0", deployment: "local" });
    const disabledResponse = responseFixture();
    await disabled.handle(request("GET", AgentRuntimeUpdateRoute), disabledResponse.response);
    expect(JSON.parse(String(disabledResponse.end.mock.calls[0]?.[0]))).toMatchObject({
      status: "not-configured",
      action: "none",
    });
  });

  test("uses the operator action for a local server update", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            product: "senera",
            version: "1.3.0",
            tag: "v1.3.0",
            releaseName: "Senera v1.3.0",
            releaseUrl: "https://github.com/example/senera/releases/tag/v1.3.0",
          }),
          { status: 200 },
        ),
    );
    const api = new AgentRuntimeUpdateHttpApi({
      currentVersion: "1.2.0",
      deployment: "local",
      manifestUrl: "https://updates.example.com/senera-update.json",
      fetch: fetcher,
    });
    const response = responseFixture();

    await api.handle(request("GET", AgentRuntimeUpdateRoute), response.response);

    expect(JSON.parse(String(response.end.mock.calls[0]?.[0]))).toMatchObject({
      status: "available",
      action: "operator",
    });
  });

  test("rejects a manifest whose release tag does not match its version", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            product: "senera",
            version: "1.3.0",
            tag: "v1.2.0",
            releaseName: "Senera v1.3.0",
            releaseUrl: "https://github.com/example/senera/releases/tag/v1.3.0",
          }),
          { status: 200 },
        ),
    );
    const api = new AgentRuntimeUpdateHttpApi({
      currentVersion: "1.2.0",
      deployment: "container",
      manifestUrl: "https://updates.example.com/senera-update.json",
      fetch: fetcher,
    });
    const response = responseFixture();

    await api.handle(request("GET", `${AgentRuntimeUpdateRoute}?refresh=1`), response.response);

    expect(JSON.parse(String(response.end.mock.calls[0]?.[0]))).toMatchObject({
      status: "unavailable",
      action: "none",
    });
  });

  test("follows redirects to a declared GitHub release asset host", async () => {
    const updateOrigin = createAgentRuntimeUpdateOrigin({
      repositoryUrl: "https://github.com/example/senera",
      trustedRedirectHosts: ["objects.githubusercontent.com"],
    });
    const redirectUrl = "https://objects.githubusercontent.com/senera-update.json?download=1";
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url.endsWith("senera-update.json")) {
        return new Response(undefined, { status: 302, headers: { location: redirectUrl } });
      }
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          product: "senera",
          version: "1.3.0",
          tag: "v1.3.0",
          releaseName: "Senera v1.3.0",
          releaseUrl: "https://github.com/example/senera/releases/tag/v1.3.0",
        }),
        { status: 200 },
      );
    });
    const api = new AgentRuntimeUpdateHttpApi({
      currentVersion: "1.2.0",
      deployment: "local",
      updateOrigin,
      fetch: fetcher,
    });
    const response = responseFixture();

    await api.handle(request("GET", `${AgentRuntimeUpdateRoute}?refresh=1`), response.response);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(String(response.end.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      status: "available",
      latest: { releaseUrl: "https://github.com/example/senera/releases/tag/v1.3.0" },
    });
    expect(payload).not.toHaveProperty("source");
    expect(payload).not.toHaveProperty("sources");
  });

  test("reports an unpublished GitHub release manifest", async () => {
    const updateOrigin = createAgentRuntimeUpdateOrigin({
      repositoryUrl: "https://github.com/example/senera",
    });
    const fetcher = vi.fn<typeof fetch>(async () => new Response(undefined, { status: 404 }));
    const api = new AgentRuntimeUpdateHttpApi({
      currentVersion: "1.2.0",
      deployment: "local",
      updateOrigin,
      fetch: fetcher,
    });
    const response = responseFixture();

    await api.handle(request("GET", `${AgentRuntimeUpdateRoute}?refresh=1`), response.response);

    expect(JSON.parse(String(response.end.mock.calls[0]?.[0]))).toMatchObject({
      status: "unavailable",
      diagnostic: { code: AgentRuntimeUpdateFailureCodes.NotPublished },
    });
  });
});

function request(method: string, url: string): IncomingMessage {
  return { method, url } as IncomingMessage;
}

function responseFixture(): {
  response: ServerResponse;
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  const writeHead = vi.fn();
  const end = vi.fn();
  return {
    response: { writeHead, end } as unknown as ServerResponse,
    writeHead,
    end,
  };
}
