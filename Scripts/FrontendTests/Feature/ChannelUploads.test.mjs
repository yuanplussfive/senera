import "fake-indexeddb/auto";
import { afterEach, expect, test, vi } from "vitest";
import { reactive } from "vue";
import { File as NodeFile } from "node:buffer";
import { uploadResource } from "../../../Frontend/src/api/resourceUpload.ts";
import { ComposerAttachmentDraft } from "../../../Frontend/src/api/composerAttachmentDraft.ts";
import { messageDraftRepository } from "../../../Frontend/src/api/messageDraftRepository.ts";
import { readSeneraComposer } from "../../../Frontend/qq/client/src/renderer/src/runtime/seneraComposerStorage.ts";
import { buildSeneraMessage } from "../../../Frontend/qq/client/src/renderer/src/runtime/seneraMessageDraft.ts";
import { OneBotPendingRequests } from "../../../Frontend/qq/client/src/renderer/src/function/utils/oneBotPendingRequests.ts";
import {
  shouldReconnectClient,
  waitForClientConnection,
} from "../../../Frontend/qq/client/src/renderer/src/runtime/connectionPolicy.ts";

vi.mock("../../../Frontend/src/api/resourceUpload.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  uploadResource: vi.fn(),
}));
const base = "https://computer.test/?workspaceId=workspace-a";
const resource = {
  resourceUri: "senera://resource/p1c2t3",
  name: "photo.png",
  mime: "image/png",
  size: 5,
  status: "uploaded",
};
const releases = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function createDraft(draftKey) {
  const NativeUrl = URL;
  vi.stubGlobal(
    "URL",
    class extends NativeUrl {
      static createObjectURL = vi.fn(() => "blob:preview");
      static revokeObjectURL = vi.fn();
    },
  );
  const draft = new ComposerAttachmentDraft({
    scope: "onebot11",
    draftKey,
    uploadUrl: "https://computer.test/api/resources?workspaceId=workspace-a",
    createId: () => crypto.randomUUID(),
    headers: async () => ({ "X-Senera-Csrf": "test-csrf" }),
    describeError: (error) => error.message,
    interruptedMessage: () => "Upload interrupted",
    onStorageError: vi.fn(),
  });
  releases.push(draft.retain());
  return draft;
}

test("replacing all body text never removes selected media, and marker-like text stays literal", async () => {
  uploadResource.mockResolvedValueOnce(resource);
  const draft = createDraft();
  const file = new File(["photo"], "photo.png", { type: "image/png" });
  await draft.enqueue([file], "image");
  await vi.waitFor(() => expect(draft.store.getState().pending[0].status).toBe("uploaded"));
  const snapshot = draft.store.getState().pending;
  for (const text of ["这是啥", "完全重新输入", "", "[SQ:0] is ordinary text"]) {
    const message = buildSeneraMessage(text, [], snapshot, base);
    expect(message.filter((part) => part.type === "image")).toEqual([
      {
        type: "image",
        file: resource.resourceUri,
        name: resource.name,
        content_type: resource.mime,
        size: 5,
        url: "https://computer.test/api/resources/p1c2t3?workspaceId=workspace-a",
      },
    ]);
    expect(message.filter((part) => part.type === "text")).toEqual(text ? [{ type: "text", text }] : []);
  }
  expect(uploadResource).toHaveBeenCalledOnce();
  expect(uploadResource.mock.calls[0][1]).toBe(file);
  expect(uploadResource.mock.calls[0][2]).toMatchObject({ headers: { "X-Senera-Csrf": "test-csrf" } });
});

test("quotes, mentions, faces and simultaneous image/file references remain structured without mutation", async () => {
  const draft = createDraft();
  await draft.addUploaded(resource, "image");
  await draft.addUploaded(
    { ...resource, resourceUri: "senera://resource/f1l2e3", name: "notes.txt", mime: "text/plain" },
    "file",
  );
  const segments = [
    { type: "reply", id: "42" },
    { type: "at", qq: "123" },
    { type: "face", id: 5 },
  ];
  const message = buildSeneraMessage("说明", segments, draft.store.getState().pending, base);
  expect(message.map((part) => part.type)).toEqual(["reply", "at", "face", "text", "image", "file"]);
  expect(message.slice(0, 3)).toEqual(segments);
  message[0].id = "changed";
  expect(segments[0].id).toBe("42");
  expect(uploadResource).not.toHaveBeenCalled();
});

test("failed uploads cannot silently send text alone; retry and send failure retain the same resource", async () => {
  uploadResource.mockRejectedValueOnce(new Error("network failed")).mockResolvedValueOnce(resource);
  const draft = createDraft();
  await draft.enqueue([new File(["photo"], "photo.png", { type: "image/png" })], "image");
  await vi.waitFor(() => expect(draft.store.getState().pending[0].status).toBe("error"));
  expect(() => buildSeneraMessage("这是啥", [], draft.store.getState().pending, base)).toThrow("network failed");
  expect(() => draft.collect()).toThrow("network failed");
  draft.retry(draft.store.getState().pending[0].id);
  await vi.waitFor(() => expect(draft.collect()).toEqual([resource]));
  const first = buildSeneraMessage("这是啥", [], draft.store.getState().pending, base);
  expect(buildSeneraMessage("再试一次", [], draft.store.getState().pending, base)[1]).toEqual(first[1]);
  expect(uploadResource).toHaveBeenCalledTimes(2);
});

test("only an acknowledged send removes its snapshot; new selections and interrupted drafts survive", async () => {
  const draft = createDraft();
  await draft.addUploaded(resource, "image");
  const sent = draft.store.getState().pending.slice();
  await draft.addUploaded({ ...resource, name: "new.png" }, "image");
  draft.commit(sent);
  expect(draft.store.getState().pending.map((entry) => entry.fileName)).toEqual(["new.png"]);
  draft.remove(draft.store.getState().pending[0].id);
  expect(draft.store.getState().pending).toEqual([]);
});

test("durable channel drafts restore acknowledged resources without another upload", async () => {
  const key = crypto.randomUUID();
  const first = createDraft(key);
  await first.addUploaded(resource, "image");
  await first.flush();
  const restored = createDraft(key);
  await restored.ready;
  expect(restored.collect()).toEqual([resource]);
  expect(restored.store.getState().pending[0].previewUrl).toBe(
    "https://computer.test/api/resources/p1c2t3?workspaceId=workspace-a",
  );
  expect(buildSeneraMessage("重新打开后编辑", [], restored.store.getState().pending, base)[1].file).toBe(
    resource.resourceUri,
  );
  expect(uploadResource).not.toHaveBeenCalled();
  first.clear();
  restored.clear();
});

test("interrupted persisted YAML uploads resume automatically after document restoration", async () => {
  const key = crypto.randomUUID();
  const yaml = { ...resource, name: "配置文件.yaml", mime: "application/octet-stream", size: 9 };
  const saved = createDraft(key);
  uploadResource
    .mockImplementationOnce(
      (_url, _file, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        }),
    )
    .mockResolvedValueOnce(yaml);
  await saved.enqueue([new NodeFile(["value: 1\n"], yaml.name)], "file");
  await vi.waitFor(() => expect(uploadResource).toHaveBeenCalledOnce());
  await saved.flush();
  const reopened = createDraft(key);
  await reopened.ready;
  await vi.waitFor(() => expect(reopened.store.getState().pending[0].status).toBe("uploaded"));
  expect(uploadResource).toHaveBeenCalledTimes(2);
  expect(reopened.store.getState().pending[0].attachment).toEqual(yaml);
  expect(buildSeneraMessage("这是啥", [], [reopened.store.getState().pending[0]], base)[1]).toMatchObject({
    type: "file",
    name: yaml.name,
    file: yaml.resourceUri,
  });
  saved.clear();
  reopened.clear();
});

test("restored request failures retain their original cause instead of automatically retrying", async () => {
  const key = crypto.randomUUID();
  const saved = createDraft(key);
  uploadResource.mockRejectedValueOnce(new Error("HTTP 413"));
  await saved.enqueue([new NodeFile(["value: 1\n"], "配置文件.yaml")], "file");
  await vi.waitFor(() => expect(saved.store.getState().pending[0].status).toBe("error"));
  await saved.flush();
  const reopened = createDraft(key);
  await reopened.ready;
  expect(reopened.store.getState().pending[0]).toMatchObject({ status: "error", error: "HTTP 413" });
  expect(uploadResource).toHaveBeenCalledOnce();
  saved.clear();
  reopened.clear();
});

test("the storage upgrade preserves old media even when its editable marker was already deleted", async () => {
  const key = crypto.randomUUID();
  await messageDraftRepository.write(key, {
    message: "这是啥",
    segments: [
      { type: "text", text: "[图片]" },
      { type: "reply", id: "42" },
    ],
  });
  await messageDraftRepository.write(key + ":images", [{ id: 0, kind: "image", resource }]);
  const draft = createDraft(key);
  const upgraded = await readSeneraComposer(key, draft);
  expect(upgraded).toMatchObject({ version: 2, message: "这是啥", parts: [{ value: { type: "reply", id: "42" } }] });
  expect(
    buildSeneraMessage(
      upgraded.message,
      upgraded.parts.map((part) => part.value),
      draft.store.getState().pending,
      base,
    ).map((part) => part.type),
  ).toEqual(["reply", "text", "image"]);
  await readSeneraComposer(key, draft);
  expect(draft.store.getState().pending).toHaveLength(1);
  expect(await messageDraftRepository.read(key + ":images")).toBeUndefined();
  expect(uploadResource).not.toHaveBeenCalled();
  draft.clear();
});

test("removing a pending attachment aborts its request and a late response cannot resurrect it", async () => {
  let complete;
  uploadResource.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const draft = createDraft();
  await draft.enqueue([new File(["photo"], "photo.png")]);
  await vi.waitFor(() => expect(uploadResource).toHaveBeenCalledOnce());
  const signal = uploadResource.mock.calls[0][2].signal;
  draft.remove(draft.store.getState().pending[0].id);
  expect(signal.aborted).toBe(true);
  complete(resource);
  await Promise.resolve();
  expect(draft.store.getState().pending).toEqual([]);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});

test("uploads wait for the selected file's durable write and survive the composer releasing its view", async () => {
  let persist;
  const saved = new Promise((resolve) => {
    persist = resolve;
  });
  const originalWrite = messageDraftRepository.write.bind(messageDraftRepository);
  vi.spyOn(messageDraftRepository, "write").mockImplementation((key, value) =>
    saved.then(() => originalWrite(key, value)),
  );
  uploadResource.mockResolvedValue(resource);
  const draft = createDraft(crypto.randomUUID());
  await draft.enqueue([new NodeFile(["photo"], "photo.png", { type: "image/png" })]);
  expect(draft.store.getState().pending).toHaveLength(1);
  expect(uploadResource).not.toHaveBeenCalled();
  releases.splice(0).forEach((release) => release());
  persist();
  await vi.waitFor(() => expect(draft.collect()).toEqual([resource]));
  expect(uploadResource).toHaveBeenCalledOnce();
  draft.clear();
  await draft.flush();
});

test("a failed durable write blocks HTTP and keeps the selected file with an explicit error", async () => {
  vi.spyOn(messageDraftRepository, "write").mockRejectedValue(new DOMException("Storage full", "QuotaExceededError"));
  const draft = createDraft(crypto.randomUUID());
  await draft.enqueue([new NodeFile(["photo"], "photo.png")]);
  await vi.waitFor(() =>
    expect(draft.store.getState().pending[0]).toMatchObject({
      status: "error",
      error: "Attachment draft could not be saved.",
      fileName: "photo.png",
    }),
  );
  expect(draft.store.getState().pending[0].file).toBeDefined();
  expect(uploadResource).not.toHaveBeenCalled();
  await expect(draft.flush()).rejects.toThrow("Attachment draft could not be saved.");
});

test("removing a file during persistence prevents its upload from starting", async () => {
  let persist;
  const saved = new Promise((resolve) => {
    persist = resolve;
  });
  vi.spyOn(messageDraftRepository, "write").mockReturnValue(saved);
  const draft = createDraft(crypto.randomUUID());
  await draft.enqueue([new NodeFile(["photo"], "photo.png")]);
  draft.remove(draft.store.getState().pending[0].id);
  persist();
  await draft.flush();
  await Promise.resolve();
  expect(uploadResource).not.toHaveBeenCalled();
  expect(draft.store.getState().pending).toEqual([]);
});

test("heartbeat timeouts reconnect while normal closure and permanent protocol rejections do not", () => {
  for (const code of [1005, 1006, 1011, 1012, 1013, 4000]) expect(shouldReconnectClient(code)).toBe(true);
  for (const code of [1000, 1008, 1009, 4001, 4401, 4403]) expect(shouldReconnectClient(code)).toBe(false);
});

test("sends wait for authenticated reconnection; cancellation and permanent failure preserve the draft", async () => {
  const state = reactive({ phase: "reconnecting" });
  const ready = waitForClientConnection(() => state.phase);
  state.phase = "connected";
  await ready;
  state.phase = "reconnecting";
  const controller = new AbortController();
  const aborted = expect(waitForClientConnection(() => state.phase, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await aborted;
  const disconnected = expect(waitForClientConnection(() => state.phase)).rejects.toThrow("重新连接");
  state.phase = "disconnected";
  await disconnected;
  vi.useFakeTimers();
  state.phase = "reconnecting";
  const timeout = expect(waitForClientConnection(() => state.phase, undefined, 100)).rejects.toThrow("内容已保留");
  await vi.advanceTimersByTimeAsync(100);
  await timeout;
  expect(vi.getTimerCount()).toBe(0);
});

test("OneBot correlates immediate replies and rejects outstanding calls on disconnect", async () => {
  vi.useFakeTimers();
  const requests = new OneBotPendingRequests();
  await expect(
    requests.request("immediate", 1000, () => requests.resolve("immediate", { status: "ok" })),
  ).resolves.toEqual({ status: "ok" });
  const failure = expect(requests.request("send", 50_000, () => {})).rejects.toThrow("connection lost");
  requests.rejectAll(new Error("connection lost"));
  await failure;
  expect(vi.getTimerCount()).toBe(0);
});
