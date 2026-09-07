import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AgentModelsDevCatalog,
  type AgentModelsDevCatalogOptions,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentModelsDevCatalog.js";

const sourceUrl = "https://catalog.test/models.json";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("models.dev catalog", () => {
  test("fetches, projects, indexes, persists, and clones model metadata", async () => {
    const root = await createRoot();
    const now = () => Date.parse("2026-09-07T00:00:00.000Z");
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("accept")).toBe("application/json");
      return jsonResponse(catalogPayload(), {
        etag: "catalog-v1",
        "last-modified": "Mon, 07 Sep 2026 00:00:00 GMT",
      });
    });
    const onUpdated = vi.fn();
    const catalog = new AgentModelsDevCatalog(options(root, { fetchImpl, now, onUpdated }));

    await expect(catalog.snapshot()).resolves.toMatchObject({
      source: "models.dev",
      state: "ready",
      sourceKind: "network",
      modelCount: 4,
      providerCount: 1,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(onUpdated).toHaveBeenCalledOnce();

    const providerMatch = catalog.resolve("OPENAI", "GPT-4O");
    expect(providerMatch).toMatchObject({
      providerId: "openai",
      sourceModelId: "gpt-4o",
      id: "openai/gpt-4o",
      contextLimit: 128_000,
      inputLimit: 128_000,
      outputLimit: 16_000,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      license: "MIT",
      pricing: { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 0.4 },
      links: [{ label: "Docs", url: "https://docs.test/gpt-4o", type: "documentation" }],
    });
    expect(catalog.resolve(undefined, "OPENAI/GPT-4O")).toMatchObject({ sourceModelId: "openai/gpt-4o" });
    expect(catalog.resolve(undefined, "solo-model")).toMatchObject({ name: "Solo" });
    expect(catalog.resolve("missing", "unknown")).toBeUndefined();
    expect(catalog.resolve("openai", "")).toBeUndefined();

    providerMatch!.inputModalities.push("mutated");
    expect(catalog.resolve("openai", "gpt-4o")?.inputModalities).toEqual(["text", "image"]);

    const stored = JSON.parse(await fs.readFile(path.join(root, "catalog.json"), "utf8")) as Record<string, unknown>;
    expect(stored).toMatchObject({ version: 1, sourceUrl, etag: "catalog-v1", providerCount: 1 });
    expect(stored.entries).toHaveLength(4);
  });

  test("uses a fresh cache, sends validators, and accepts a not-modified response", async () => {
    const root = await createRoot();
    let clock = Date.parse("2026-09-07T00:00:00.000Z");
    const firstFetch = vi.fn<typeof fetch>(async () => jsonResponse(catalogPayload(), { etag: "catalog-v1" }));
    const first = new AgentModelsDevCatalog(options(root, { fetchImpl: firstFetch, now: () => clock }));
    await first.refresh(true);
    first.stop();

    clock += 61_000;
    const secondFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("if-none-match")).toBe("catalog-v1");
      return new Response(null, { status: 304 });
    });
    const second = new AgentModelsDevCatalog(options(root, { fetchImpl: secondFetch, now: () => clock }));
    await expect(second.snapshot()).resolves.toMatchObject({ state: "ready", sourceKind: "cache", modelCount: 4 });
    expect(secondFetch).toHaveBeenCalledOnce();
  });

  test("deduplicates concurrent refreshes and supports the periodic lifecycle", async () => {
    const root = await createRoot();
    let resolveFetch!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => (resolveFetch = resolve)));
    const catalog = new AgentModelsDevCatalog(
      options(root, { fetchImpl, refreshIntervalMs: 60_000, now: () => Date.now() }),
    );

    const first = catalog.refresh(true);
    const second = catalog.refresh(true);
    expect(second).not.toBe(first);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    resolveFetch(jsonResponse(catalogPayload()));
    await first;

    catalog.start();
    catalog.start();
    catalog.stop();
    catalog.stop();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("reports unavailable and stale states without discarding usable cache data", async () => {
    const unavailableRoot = await createRoot();
    const unavailableErrors: unknown[] = [];
    const unavailable = new AgentModelsDevCatalog(
      options(unavailableRoot, {
        fetchImpl: vi.fn<typeof fetch>(async () => new Response("blocked", { status: 503, statusText: "Unavailable" })),
        onError: (error) => unavailableErrors.push(error),
      }),
    );
    await expect(unavailable.snapshot()).resolves.toMatchObject({ state: "unavailable", modelCount: 0 });
    expect(unavailableErrors).toEqual([]);
    expect(unavailable.resolve(undefined, "anything")).toBeUndefined();

    const staleRoot = await createRoot();
    let clock = Date.parse("2026-09-07T00:00:00.000Z");
    const initial = new AgentModelsDevCatalog(
      options(staleRoot, {
        fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(catalogPayload())),
        now: () => clock,
      }),
    );
    await initial.snapshot();
    clock += 61_000;
    const stale = new AgentModelsDevCatalog(
      options(staleRoot, {
        fetchImpl: vi.fn<typeof fetch>(async () => new Response("upstream down", { status: 500 })),
        now: () => clock,
      }),
    );
    await expect(stale.snapshot()).resolves.toMatchObject({ state: "stale", modelCount: 4, sourceKind: "cache" });
    expect(stale.resolve(undefined, "solo-model")).toMatchObject({ name: "Solo" });
  });

  test("rejects malformed, mismatched, and oversized cache payloads", async () => {
    const malformedRoot = await createRoot();
    await fs.writeFile(path.join(malformedRoot, "catalog.json"), "{not-json", "utf8");
    const errors: unknown[] = [];
    const malformed = new AgentModelsDevCatalog(
      options(malformedRoot, {
        fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(catalogPayload())),
        onError: (error) => errors.push(error),
      }),
    );
    await expect(malformed.snapshot()).resolves.toMatchObject({ state: "ready", modelCount: 4 });
    expect(errors).toHaveLength(1);

    const mismatchRoot = await createRoot();
    await fs.writeFile(
      path.join(mismatchRoot, "catalog.json"),
      JSON.stringify({
        version: 1,
        sourceUrl: "https://other.test/catalog.json",
        fetchedAt: "2026-09-07T00:00:00.000Z",
        checkedAt: "2026-09-07T00:00:00.000Z",
        entries: [{ sourceModelId: "ignored" }],
      }),
      "utf8",
    );
    const mismatch = new AgentModelsDevCatalog(
      options(mismatchRoot, { fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(catalogPayload())) }),
    );
    await expect(mismatch.snapshot()).resolves.toMatchObject({ state: "ready", modelCount: 4 });

    const oversized = new AgentModelsDevCatalog(
      options(await createRoot(), {
        maximumResponseBytes: 1,
        fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(catalogPayload())),
      }),
    );
    await expect(oversized.snapshot()).resolves.toMatchObject({ state: "unavailable", modelCount: 0 });
  });
});

function options(
  workspaceRoot: string,
  overrides: Partial<AgentModelsDevCatalogOptions> = {},
): AgentModelsDevCatalogOptions {
  return { workspaceRoot, sourceUrl, cachePath: "catalog.json", ttlMs: 60_000, ...overrides };
}

async function createRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-models-dev-"));
  roots.push(root);
  return root;
}

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function catalogPayload(): unknown {
  return {
    models: {
      "openai/gpt-4o": {
        name: "GPT-4o",
        modalities: { input: ["text", "image"], output: "text" },
        limit: { context: 128_000, input: 128_000, output: 16_000 },
        license: { name: "MIT" },
        links: [
          { label: "Docs", url: "https://docs.test/gpt-4o", type: "documentation" },
          { label: "", url: "https://invalid.test" },
        ],
      },
      "solo-model": { name: "Solo", modalities: { input: "text", output: ["text"] } },
      invalid: null,
    },
    providers: {
      OpenAI: {
        models: {
          "gpt-4o": {
            id: "openai/gpt-4o",
            name: "GPT-4o",
            reasoning: true,
            tool_call: true,
            structured_output: true,
            attachment: true,
            temperature: false,
            open_weights: false,
            release_date: "2024-05-13",
            last_updated: "2026-01-01",
            cost: { input: 2, output: 8, cache_read: 0.2, cache_write: 0.4 },
            limit: { context: 128_000, input: 128_000, output: 16_000 },
            modalities: { input: ["text", "image"], output: ["text"] },
            license: { id: "MIT" },
            links: [{ label: "Docs", url: "https://docs.test/gpt-4o", type: "documentation" }],
          },
        },
      },
      Empty: { models: "not-an-object" },
    },
  };
}
