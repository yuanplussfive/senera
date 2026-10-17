import http from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import type { AgentSystemExtensionSettingsItem } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolSource.js";
import {
  AgentExtensionSecretHttpApi,
  AgentExtensionSecretHttpRoute,
} from "../../../Source/AgentSystem/Config/AgentExtensionSecretHttpApi.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("extension secret HTTP API", () => {
  test("returns a declared secret without exposing the rest of the extension config", async () => {
    const baseUrl = await createHarness();
    const url = new URL(AgentExtensionSecretHttpRoute, baseUrl);
    url.searchParams.set("extensionId", "web-tools");
    url.searchParams.append("path", "search");
    url.searchParams.append("path", "codexApiKey");

    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      extensionId: "web-tools",
      path: ["search", "codexApiKey"],
      value: "sk-codex-secret",
    });
  });

  test("rejects undeclared and non-secret fields", async () => {
    const baseUrl = await createHarness();
    const url = new URL(AgentExtensionSecretHttpRoute, baseUrl);
    url.searchParams.set("extensionId", "web-tools");
    url.searchParams.append("path", "search");
    url.searchParams.append("path", "provider");

    const response = await fetch(url);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({ ok: false, error: { code: "extension_secret_not_found" } });
    expect(JSON.stringify(payload)).not.toContain("sk-codex-secret");
  });
});

async function createHarness(): Promise<string> {
  const api = new AgentExtensionSecretHttpApi({
    configSnapshot: () => ({
      ModelProviders: [],
      Extensions: {
        "web-tools": { Configuration: { search: { provider: "codex", codexApiKey: "sk-codex-secret" } } },
      },
    }),
    systemExtensions: () =>
      [
        {
          id: "web-tools",
          configuration: {
            sections: [
              {
                name: "search",
                label: "Search",
                keyCount: 2,
                fields: [
                  {
                    label: "Provider",
                    section: "search",
                    key: "provider",
                    path: ["search", "provider"],
                    type: "string",
                    configured: true,
                    effectiveValue: "codex",
                    missing: false,
                    value: "codex",
                    valueSource: "explicit",
                    required: true,
                    essential: true,
                  },
                  {
                    label: "Codex key",
                    section: "search",
                    key: "codexApiKey",
                    path: ["search", "codexApiKey"],
                    type: "string",
                    secret: true,
                    configured: true,
                    effectiveValue: "sk-codex-secret",
                    missing: false,
                    value: "sk-codex-secret",
                    valueSource: "explicit",
                    required: true,
                    essential: true,
                  },
                ],
              },
            ],
            configured: true,
            value: {},
            effectiveValue: {},
            defaults: {},
          },
        },
      ] as unknown as readonly AgentSystemExtensionSettingsItem[],
    isOriginAllowed: (origin) => origin === "http://frontend.test",
  });
  const server = http.createServer((request, response) => api.handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to start extension secret test server.");
  return `http://127.0.0.1:${address.port}`;
}
