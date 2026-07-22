import { afterEach, expect, test, vi } from "vitest";
import {
  buildUploadContentUrl,
  buildUploadUrl,
  DEFAULT_UPLOAD_TIMEOUT_MS,
  uploadFile,
} from "../../../Frontend/src/api/uploadClient.ts";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  TestXmlHttpRequest.reset();
});

test("upload client projects secure WebSocket URLs and reports upload progress", async () => {
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  const progress = vi.fn();
  const file = new File(["hello"], "hello.txt", { type: "text/plain" });
  const uploadUrl = buildUploadUrl("wss://agent.example.test/socket?token=secret#fragment");

  const resultPromise = uploadFile(uploadUrl, file, { onProgress: progress });
  const request = TestXmlHttpRequest.instances[0];
  request.reportProgress(2, 5);
  request.respond(201, {
    ok: true,
    uploads: [
      {
        uploadUri: "senera://upload/hello",
        name: "hello.txt",
        mime: "text/plain",
        size: 5,
        status: "uploaded",
      },
    ],
  });

  await expect(resultPromise).resolves.toMatchObject({
    uploadUri: "senera://upload/hello",
    name: "hello.txt",
    size: 5,
  });
  expect(uploadUrl).toBe("https://agent.example.test/api/uploads");
  expect(request.method).toBe("POST");
  expect(request.url).toBe(uploadUrl);
  expect(request.withCredentials).toBe(true);
  expect(request.timeout).toBe(DEFAULT_UPLOAD_TIMEOUT_MS);
  expect(request.body).toBeInstanceOf(FormData);
  expect(progress.mock.calls.map(([value]) => value)).toEqual([
    { loaded: 2, total: 5, ratio: 0.4 },
    { loaded: 5, total: 5, ratio: 1 },
  ]);
});

test("upload client builds credential-free content URLs from opaque upload references", () => {
  expect(
    buildUploadContentUrl(
      "https://user:password@agent.example.test/api/uploads?token=secret#fragment",
      "senera://upload/upl_fixture",
    ),
  ).toBe("https://agent.example.test/api/uploads/upl_fixture/content");
  expect(buildUploadContentUrl("wss://agent.example.test/socket", "senera://upload/a%20b")).toBe(
    "https://agent.example.test/api/uploads/a%20b/content",
  );
});

test.each([
  "https://example.test/file",
  "senera://other/upl_fixture",
  "senera://upload/a/b",
  "senera://upload/..%2Foutside",
  "senera://upload/upl_fixture?token=secret",
])("upload client rejects invalid upload reference %s", (uploadUri) => {
  expect(buildUploadContentUrl("https://agent.example.test/api/uploads", uploadUri)).toBeUndefined();
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
  const promise = uploadFile("http://agent.test/api/uploads", new File(["x"], "x.txt"));

  TestXmlHttpRequest.instances[0].emit(event);

  await expect(promise).rejects.toThrow(frontendMessage(messageKey));
});

test("upload client rejects malformed, failed, and empty success responses", async () => {
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  const file = new File(["x"], "x.txt");

  const malformed = uploadFile("http://agent.test/api/uploads", file);
  TestXmlHttpRequest.instances.at(-1).respondRaw(502, "not-json");
  await expect(malformed).rejects.toThrow(frontendMessage("upload.invalidJsonResponse"));

  const failed = uploadFile("http://agent.test/api/uploads", file);
  TestXmlHttpRequest.instances.at(-1).respond(400, {
    ok: false,
    error: { message: "file too large" },
  });
  await expect(failed).rejects.toThrow("file too large");

  const empty = uploadFile("http://agent.test/api/uploads", file);
  TestXmlHttpRequest.instances.at(-1).respond(200, { ok: true, uploads: [] });
  await expect(empty).rejects.toThrow(frontendMessage("upload.emptyResponse"));

  const missingUploads = uploadFile("http://agent.test/api/uploads", file);
  TestXmlHttpRequest.instances.at(-1).respond(200, { ok: true });
  await expect(missingUploads).rejects.toThrow(frontendMessage("upload.failed"));

  const invalidUpload = uploadFile("http://agent.test/api/uploads", file);
  TestXmlHttpRequest.instances.at(-1).respond(200, { ok: true, uploads: [{}] });
  await expect(invalidUpload).rejects.toThrow(frontendMessage("upload.emptyResponse"));
});

test("forwards caller-provided CSRF headers without exposing cookie values", async () => {
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  const promise = uploadFile("http://agent.test/api/uploads", new File(["x"], "x.txt"), {
    headers: { "X-Senera-Csrf": "csrf-token" },
  });
  const request = TestXmlHttpRequest.instances.at(-1);
  request.respond(200, {
    ok: true,
    uploads: [
      {
        uploadUri: "senera://upload/x",
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
