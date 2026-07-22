import http from "node:http";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, test } from "vitest";
import { resolveUploadsConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentUploadHttpApi } from "../../../Source/AgentSystem/Uploads/AgentUploadHttpApi.js";
import { AgentUploadStore } from "../../../Source/AgentSystem/Uploads/AgentUploadStore.js";
import type { ResolvedAgentUploadsConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

const KIBIBYTE = 1_024;
const HOUR_MS = 60 * 60 * 1_000;
const UploadRootDir = ".uploads";
const OnePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const roots: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("upload governance behavior", () => {
  test("rejects effective request and storage limits below the per-file limit", () => {
    const base = { ModelProviders: [] };
    expect(() =>
      resolveUploadsConfig({
        ...base,
        Uploads: { MaxFileBytes: 100, MaxRequestBytes: 99 },
      }),
    ).toThrow("Uploads.MaxRequestBytes");
    expect(() =>
      resolveUploadsConfig({
        ...base,
        Uploads: { MaxFileBytes: 100, MaxStoredBytes: 99 },
      }),
    ).toThrow("Uploads.MaxStoredBytes");
  });

  test("saves, resolves, and deletes an uploaded file", async () => {
    const harness = createStore();
    const attachment = await saveText(harness.store, "notes.txt", "hello uploads");
    const resolved = await harness.store.resolve(attachment.uploadUri);

    expect(attachment).toMatchObject({ name: "notes.txt", mime: "text/plain", size: 13, status: "uploaded" });
    expect(await fs.readFile(resolved!.filePath, "utf8")).toBe("hello uploads");
    await expect(harness.store.delete(attachment.uploadUri)).resolves.toBe(true);
    await expect(fs.stat(resolved!.uploadDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects a file that crosses the per-file byte limit and removes partial data", async () => {
    const harness = createStore({ MaxFileBytes: 4 });

    await expect(saveText(harness.store, "large.txt", "12345")).rejects.toMatchObject({
      code: "upload_too_large",
      statusCode: 413,
    });
    await expect(readUploadEntries(harness.root)).resolves.toEqual([]);
  });

  test("rejects uploads beyond the concurrent upload limit", async () => {
    const harness = createStore({ MaxConcurrentUploads: 1 });
    const firstStream = new PassThrough();
    const firstUpload = harness.store.save({ stream: firstStream, originalName: "first.txt" });

    await expect(saveText(harness.store, "second.txt", "second")).rejects.toMatchObject({
      code: "upload_concurrency_exceeded",
      statusCode: 429,
    });
    firstStream.end("first");
    await expect(firstUpload).resolves.toMatchObject({ name: "first.txt" });
  });

  test("reserves storage atomically across concurrent uploads", async () => {
    const harness = createStore({
      MaxFileBytes: KIBIBYTE,
      MaxStoredBytes: KIBIBYTE + KIBIBYTE / 2,
      MaxConcurrentUploads: 2,
    });
    const firstStream = new PassThrough();
    const firstUpload = harness.store.save({ stream: firstStream, originalName: "reserved.txt" });

    await expect(saveText(harness.store, "blocked.txt", "blocked")).rejects.toMatchObject({
      code: "upload_storage_quota_exceeded",
      statusCode: 507,
    });
    firstStream.end("reserved");
    await expect(firstUpload).resolves.toMatchObject({ name: "reserved.txt" });
  });

  test("rejects multipart requests that cross the aggregate request limit", async () => {
    const harness = await createHttpHarness({ MaxRequestBytes: 256 });
    const response = await postFiles(harness.baseUrl, [{ name: "large.txt", content: "x".repeat(512) }]);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "upload_request_too_large" },
    });
    await expect(readUploadEntries(harness.root)).resolves.toEqual([]);
  });

  test("rolls back completed files when a multipart request exceeds its file count", async () => {
    const harness = await createHttpHarness({ MaxFilesPerRequest: 1 });
    const response = await postFiles(harness.baseUrl, [
      { name: "first.txt", content: "first" },
      { name: "second.txt", content: "second" },
    ]);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "upload_file_count_exceeded" },
    });
    await expect(readUploadEntries(harness.root)).resolves.toEqual([]);
  });

  test("rejects multipart requests without files", async () => {
    const harness = await createHttpHarness();
    const form = new FormData();
    form.append("description", "metadata only");
    const response = await fetch(`${harness.baseUrl}/api/uploads`, { method: "POST", body: form });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: "upload_file_missing" } });
  });

  test("serves detected raster images through GET and HEAD with private revalidation", async () => {
    const harness = await createHttpHarness();
    const attachment = await saveBytes(harness.store, "pixel.png", OnePixelPng, "image/png");
    const contentUrl = buildContentUrl(harness.baseUrl, attachment.uploadUri);

    const response = await fetch(contentUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(OnePixelPng.byteLength));
    expect(response.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(OnePixelPng);

    const head = await fetch(contentUrl, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(OnePixelPng.byteLength));
    expect((await head.arrayBuffer()).byteLength).toBe(0);

    const preflight = await fetch(contentUrl, {
      method: "OPTIONS",
      headers: { Origin: "http://frontend.test" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://frontend.test");
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, HEAD, POST, OPTIONS");
  });

  test("returns 304 when the upload image ETag matches", async () => {
    const harness = await createHttpHarness();
    const attachment = await saveBytes(harness.store, "cached.png", OnePixelPng, "image/png");
    const contentUrl = buildContentUrl(harness.baseUrl, attachment.uploadUri);
    const initial = await fetch(contentUrl);
    const etag = initial.headers.get("etag");
    expect(etag).toBe(`"${attachment.sha256}"`);

    const cached = await fetch(contentUrl, { headers: { "If-None-Match": etag! } });
    expect(cached.status).toBe(304);
    expect((await cached.arrayBuffer()).byteLength).toBe(0);
  });

  test("rejects missing, traversing, and non-raster upload content references", async () => {
    const harness = await createHttpHarness();
    const text = await saveText(harness.store, "notes.txt", "not an image");
    const svg = await saveBytes(
      harness.store,
      "vector.svg",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      "image/svg+xml",
    );

    const textResponse = await fetch(buildContentUrl(harness.baseUrl, text.uploadUri));
    expect(textResponse.status).toBe(415);
    await expect(textResponse.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "upload_content_unsupported" },
    });

    const svgResponse = await fetch(buildContentUrl(harness.baseUrl, svg.uploadUri));
    expect(svgResponse.status).toBe(415);

    const missingResponse = await fetch(`${harness.baseUrl}/api/uploads/upl_missing/content`);
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "upload_content_not_found" },
    });

    const traversalResponse = await fetch(`${harness.baseUrl}/api/uploads/${encodeURIComponent("../outside")}/content`);
    expect(traversalResponse.status).toBe(404);
  });

  test("removes expired uploads and abandoned incomplete directories", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    let now = createdAt;
    const harness = createStore({ RetentionHours: 1 }, () => now);
    const attachment = await saveText(harness.store, "expired.txt", "expired");
    const incompleteDir = path.join(harness.root, UploadRootDir, "upl_incomplete");
    await fs.mkdir(incompleteDir, { recursive: true });
    await fs.writeFile(path.join(incompleteDir, "original"), "partial");
    await fs.utimes(incompleteDir, createdAt, createdAt);
    now = new Date(createdAt.getTime() + 2 * HOUR_MS);

    await expect(harness.store.maintain()).resolves.toMatchObject({ removedUploads: 2 });
    await expect(harness.store.resolve(attachment.uploadUri)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readUploadEntries(harness.root)).resolves.toEqual([]);
  });

  test("does not collect an upload that is still being written", async () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    let now = startedAt;
    const harness = createStore({ RetentionHours: 1 }, () => now);
    const stream = new PassThrough();
    const pendingUpload = harness.store.save({ stream, originalName: "active.txt" });
    await waitForUploadDirectory(harness.root);
    now = new Date(startedAt.getTime() + 2 * HOUR_MS);

    await expect(harness.store.maintain()).resolves.toMatchObject({ removedUploads: 0 });
    expect(await readUploadEntries(harness.root)).toHaveLength(1);
    stream.end("complete");
    await expect(pendingUpload).resolves.toMatchObject({ name: "active.txt" });
  });
});

interface UploadStoreHarness {
  root: string;
  store: AgentUploadStore;
}

function createStore(overrides: Partial<ResolvedAgentUploadsConfig> = {}, now?: () => Date): UploadStoreHarness {
  const root = mkdtempSync(path.join(os.tmpdir(), "senera-upload-"));
  roots.push(root);
  return {
    root,
    store: new AgentUploadStore({
      workspaceRoot: root,
      config: createUploadConfig(overrides),
      now,
    }),
  };
}

async function createHttpHarness(
  overrides: Partial<ResolvedAgentUploadsConfig> = {},
): Promise<UploadStoreHarness & { baseUrl: string }> {
  const harness = createStore(overrides);
  const api = new AgentUploadHttpApi({
    store: harness.store,
    isOriginAllowed: (origin) => origin === "http://frontend.test",
  });
  const server = http.createServer((request, response) => {
    void api.handle(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start upload HTTP test server.");
  }
  return { ...harness, baseUrl: `http://127.0.0.1:${address.port}` };
}

function createUploadConfig(overrides: Partial<ResolvedAgentUploadsConfig>): ResolvedAgentUploadsConfig {
  return {
    RootDir: UploadRootDir,
    MaxFileBytes: KIBIBYTE,
    MaxRequestBytes: 8 * KIBIBYTE,
    MaxFilesPerRequest: 4,
    MaxConcurrentUploads: 2,
    MaxStoredBytes: 64 * KIBIBYTE,
    RetentionHours: 24,
    MaintenanceIntervalMinutes: 15,
    ...overrides,
  };
}

function saveText(store: AgentUploadStore, name: string, content: string) {
  return store.save({
    stream: Readable.from([Buffer.from(content)]),
    originalName: name,
    declaredMime: "text/plain",
  });
}

function saveBytes(store: AgentUploadStore, name: string, content: Buffer, declaredMime: string) {
  return store.save({
    stream: Readable.from([content]),
    originalName: name,
    declaredMime,
  });
}

function buildContentUrl(baseUrl: string, uploadUri: string): string {
  const uploadId = new URL(uploadUri).pathname.split("/").filter(Boolean)[0];
  return `${baseUrl}/api/uploads/${encodeURIComponent(uploadId)}/content`;
}

async function postFiles(baseUrl: string, files: readonly { name: string; content: string }[]): Promise<Response> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", new Blob([file.content], { type: "text/plain" }), file.name);
  }
  return fetch(`${baseUrl}/api/uploads`, { method: "POST", body: form });
}

async function readUploadEntries(workspaceRoot: string): Promise<string[]> {
  return fs.readdir(path.join(workspaceRoot, UploadRootDir)).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
}

async function waitForUploadDirectory(workspaceRoot: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if ((await readUploadEntries(workspaceRoot)).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for active upload directory.");
}
