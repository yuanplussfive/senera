import http from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import {
  AgentProviderCredentialHttpApi,
  AgentProviderCredentialHttpRoute,
} from "../../../Source/AgentSystem/Config/AgentProviderCredentialHttpApi.js";

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

describe("provider credential HTTP API", () => {
  test("returns only the requested key through a non-cacheable response", async () => {
    const baseUrl = await createHarness();
    const url = new URL(AgentProviderCredentialHttpRoute, baseUrl);
    url.searchParams.set("providerId", "openai");

    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(await response.json()).toEqual({ ok: true, providerId: "openai", apiKey: "sk-live-secret" });
  });

  test("does not reveal another provider or the rest of the config", async () => {
    const baseUrl = await createHarness();
    const url = new URL(AgentProviderCredentialHttpRoute, baseUrl);
    url.searchParams.set("providerId", "missing");

    const response = await fetch(url);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({ ok: false, error: { code: "provider_not_found" } });
    expect(JSON.stringify(payload)).not.toContain("sk-live-secret");
  });
});

async function createHarness(): Promise<string> {
  const api = new AgentProviderCredentialHttpApi({
    configSnapshot: () => ({
      ModelProviderEndpoints: [
        { Id: "openai", BaseUrl: "https://example.invalid/v1", ApiKey: "sk-live-secret" },
        { Id: "other", BaseUrl: "https://other.invalid/v1", ApiKey: "sk-other-secret" },
      ],
      ModelProviders: [],
    }),
    isOriginAllowed: (origin) => origin === "http://frontend.test",
  });
  const server = http.createServer((request, response) => api.handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to start provider credential test server.");
  return `http://127.0.0.1:${address.port}`;
}
