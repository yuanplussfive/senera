import { afterEach, expect, test, vi } from "vitest";
import {
  buildResourceContentUrl,
  buildResourceUploadUrl,
  DEFAULT_UPLOAD_TIMEOUT_MS,
  uploadFile,
} from "../../../Frontend/src/api/uploadClient.ts";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { parseResourceId, resolveResourceContentUrl } from "@senera/resource-links";

afterEach(() => {
  vi.unstubAllGlobals();
  TestXmlHttpRequest.reset();
  vi.useRealTimers();
});

test("upload client projects secure WebSocket URLs and reports upload progress", async () => {
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  const progress = vi.fn();
  const file = new File(["hello"], "hello.txt", { type: "text/plain" });
  const uploadUrl = buildResourceUploadUrl("https://agent.example.test");

  const resultPromise = uploadFile(uploadUrl, file, { onProgress: progress });
  const request = TestXmlHttpRequest.instances[0];
  request.reportProgress(2, 5);
  request.respond(201, {
    ok: true,
    resources: [
      {
        resourceUri: "senera://resource/hello",
        name: "hello.txt",
        mime: "text/plain",
        size: 5,
        status: "uploaded",
      },
    ],
  });

  await expect(resultPromise).resolves.toMatchObject({
    resourceUri: "senera://resource/hello",
    name: "hello.txt",
    size: 5,
  });
  expect(uploadUrl).toBe("https://agent.example.test/api/resources");
  expect(request.method).toBe("POST");
  expect(request.url).toBe(uploadUrl);
  expect(request.withCredentials).toBe(true);
  expect(request.timeout).toBe(0);
  expect(request.body).toBeInstanceOf(FormData);
  expect(progress.mock.calls.map(([value]) => value)).toEqual([
    { loaded: 2, total: 5, ratio: 0.4 },
    { loaded: 5, total: 5, ratio: 1 },
  ]);
});

test("active upload progress renews the inactivity deadline instead of aborting a long transfer", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  const promise = uploadFile("/api/resources", new File(["file"], "file.txt"));
  const request = TestXmlHttpRequest.instances[0];
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(DEFAULT_UPLOAD_TIMEOUT_MS - 1);
    request.reportProgress(i + 1, 4);
  }
  request.respond(200, {
    ok: true,
    resources: [
      { resourceUri: "senera://resource/t1m2e3", name: "file.txt", mime: "text/plain", size: 4, status: "uploaded" },
    ],
  });
  await expect(promise).resolves.toMatchObject({ name: "file.txt" });
  expect(vi.getTimerCount()).toBe(0);
});

test("background suspension pauses the upload deadline; a real foreground stall aborts and cleans up", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  const promise = uploadFile("/api/resources", new File(["file"], "file.txt"), { idleTimeoutMs: 1000 });
  const failure = expect(promise).rejects.toThrow(frontendMessage("upload.timeout"));
  await vi.advanceTimersByTimeAsync(500);
  window.dispatchEvent(new Event("senera:pause"));
  await vi.advanceTimersByTimeAsync(60_000);
  window.dispatchEvent(new Event("senera:resume"));
  await vi.advanceTimersByTimeAsync(1000);
  await failure;
  expect(vi.getTimerCount()).toBe(0);
});

test("resource client builds credential-free content URLs from opaque resource references", () => {
  expect(
    buildResourceContentUrl(
      "https://user:password@agent.example.test/api/resources?token=secret#fragment",
      "senera://resource/upl_fixture",
    ),
  ).toBe("https://agent.example.test/api/resources/upl_fixture");
  expect(buildResourceContentUrl("wss://agent.example.test/socket", "senera://resource/asset_b")).toBe(
    "https://agent.example.test/api/resources/asset_b",
  );
});

test("uploads and both frontends resolve internal resource references without browser support for custom URL schemes", async () => {
  const BrowserURL = globalThis.URL;
  vi.stubGlobal(
    "URL",
    new Proxy(BrowserURL, {
      construct(target, args) {
        if (String(args[0]).startsWith("senera:")) throw new TypeError("Unsupported URL scheme");
        return Reflect.construct(target, args);
      },
    }),
  );
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  const reference = "senera://resource/h1y44m";
  const promise = uploadFile("http://computer.test/api/resources", new File(["image"], "phone.jpg"));
  TestXmlHttpRequest.instances.at(-1).respond(200, {
    ok: true,
    resources: [{ resourceUri: reference, name: "phone.jpg", mime: "image/jpeg", size: 5, status: "uploaded" }],
  });
  await expect(promise).resolves.toMatchObject({ resourceUri: reference });
  expect(parseResourceId(reference)).toBe("h1y44m");
  const base = "http://computer.test/?workspaceId=workspace-one";
  const contentUrl = "http://computer.test/api/resources/h1y44m?workspaceId=workspace-one";
  expect(buildResourceContentUrl(base, reference)).toBe(contentUrl);
  expect(resolveResourceContentUrl(base, reference)).toBe(contentUrl);
});

test.each(["h1y44m", "res_81d17d10efa400099ecfeec4e2754fa1", "A_b-c.d~e", "x".repeat(256)])(
  "accepts the canonical resource identity %s",
  (id) => expect(parseResourceId(`senera://resource/${id}`)).toBe(id),
);

test.each([
  "https://example.test/file",
  "senera://upload/upl_fixture",
  "senera://artifact-asset/image-1",
  "senera://other/upl_fixture",
  "senera://resource/a/b",
  "senera://resource/..%2Foutside",
  "senera://resource/upl_fixture?token=secret",
  "senera://user@resource/h1y44m",
  "senera://resource:80/h1y44m",
  "senera://resource/h1y44m#fragment",
  "senera://resource/%68%31y44m",
  "senera://resource/../h1y44m",
  "senera://resource//h1y44m",
  "senera://resource/h1y44m/",
  "senera://resource/h1y44m\n",
  "senera://resource/h1y44m\u0000",
  `senera://resource/${"x".repeat(257)}`,
])("upload client rejects invalid upload reference %s", (resourceUri) => {
  expect(buildResourceContentUrl("https://agent.example.test/api/resources", resourceUri)).toBeUndefined();
});

test.each([
  {
    event: "error",
    messageKey: "upload.networkFailed",
  },
  {
    event: "abort",
    messageKey: "upload.aborted",
  },
  {
    event: "timeout",
    messageKey: "upload.timeout",
  },
])("upload client rejects $event transport failures", async ({ event, messageKey }) => {
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  const promise = uploadFile("http://agent.test/api/resources", new File(["x"], "x.txt"));

  TestXmlHttpRequest.instances[0].emit(event);

  await expect(promise).rejects.toThrow(frontendMessage(messageKey));
});

test("upload client rejects malformed, failed, and empty success responses", async () => {
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  const file = new File(["x"], "x.txt");

  const malformed = uploadFile("http://agent.test/api/resources", file);
  TestXmlHttpRequest.instances.at(-1).respondRaw(502, "not-json");
  await expect(malformed).rejects.toThrow(frontendMessage("upload.invalidJsonResponse"));

  const failed = uploadFile("http://agent.test/api/resources", file);
  TestXmlHttpRequest.instances.at(-1).respond(400, {
    ok: false,
    error: { message: "file too large" },
  });
  await expect(failed).rejects.toThrow("file too large");

  const empty = uploadFile("http://agent.test/api/resources", file);
  TestXmlHttpRequest.instances.at(-1).respond(200, { ok: true, resources: [] });
  await expect(empty).rejects.toThrow(frontendMessage("upload.emptyResponse"));

  const missingUploads = uploadFile("http://agent.test/api/resources", file);
  TestXmlHttpRequest.instances.at(-1).respond(200, { ok: true });
  await expect(missingUploads).rejects.toThrow(frontendMessage("upload.failed"));

  const invalidUpload = uploadFile("http://agent.test/api/resources", file);
  TestXmlHttpRequest.instances.at(-1).respond(200, { ok: true, resources: [{}] });
  await expect(invalidUpload).rejects.toThrow("resourceUri, name, mime, size, status");
});

test("distinguishes an invalid resource URI from an empty upload without exposing response data", async () => {
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  const promise = uploadFile("http://agent.test/api/resources", new File(["x"], "x.txt"));
  TestXmlHttpRequest.instances.at(-1).respond(200, {
    ok: true,
    resources: [
      {
        resourceUri: "senera://other/private-reference",
        name: "x.txt",
        mime: "text/plain",
        size: 1,
        status: "uploaded",
      },
    ],
  });
  await expect(promise).rejects.toThrow(frontendMessage("upload.invalidAttachmentResponse", { fields: "resourceUri" }));
});

test("forwards caller-provided CSRF headers without exposing cookie values", async () => {
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  const promise = uploadFile("http://agent.test/api/resources", new File(["x"], "x.txt"), {
    headers: { "X-Senera-Csrf": "csrf-token" },
  });
  const request = TestXmlHttpRequest.instances.at(-1);
  request.respond(200, {
    ok: true,
    resources: [
      {
        resourceUri: "senera://resource/x",
        name: "x.txt",
        mime: "text/plain",
        size: 1,
        status: "uploaded",
      },
    ],
  });

  await expect(promise).resolves.toMatchObject({ name: "x.txt" });
  expect(request.headers).toMatchObject({ "X-Senera-Csrf": "csrf-token" });
});

test("upload cancellation aborts the request and releases its signal listener", async () => {
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const promise = uploadFile("http://agent.test/api/resources", new File(["x"], "x.txt"), {
    signal: controller.signal,
  });
  controller.abort();
  await expect(promise).rejects.toThrow(frontendMessage("upload.aborted"));
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  const count = TestXmlHttpRequest.instances.length;
  await expect(
    uploadFile("http://agent.test/api/resources", new File(["x"], "x.txt"), { signal: controller.signal }),
  ).rejects.toThrow(frontendMessage("upload.aborted"));
  expect(TestXmlHttpRequest.instances).toHaveLength(count);
});

class TestXmlHttpRequest {
  static instances = [];

  static reset() {
    TestXmlHttpRequest.instances = [];
  }

  constructor() {
    this.listeners = new Map();
    this.upload = new TestEventTarget();
    this.headers = {};
    this.status = 0;
    this.responseText = "";
    TestXmlHttpRequest.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  send(body) {
    this.body = body;
  }

  abort() {
    this.emit("abort");
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  emit(type, event = { type }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  reportProgress(loaded, total) {
    this.upload.emit("progress", {
      lengthComputable: true,
      loaded,
      total,
    });
  }

  respond(status, payload) {
    this.respondRaw(status, JSON.stringify(payload));
  }

  respondRaw(status, responseText) {
    this.status = status;
    this.responseText = responseText;
    this.emit("load");
  }
}

class TestEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
