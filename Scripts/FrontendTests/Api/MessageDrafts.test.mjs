import { afterEach, expect, test, vi } from "vitest";
import { IDBFactory, forceCloseDatabase } from "fake-indexeddb";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { MessageDraftRepository } from "../../../Frontend/src/api/messageDraftRepository.ts";
import { AttachmentUploadTask } from "../../../Frontend/src/api/attachmentUploadTask.ts";
import { uploadFile } from "../../../Frontend/src/api/uploadClient.ts";

vi.mock("../../../Frontend/src/api/uploadClient.ts", () => ({ uploadFile: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

const resource = {
  resourceUri: "senera://resource/a1b2c3",
  name: "photo.png",
  mime: "image/png",
  size: 5,
  status: "uploaded",
};

test("durable drafts survive reopening and remain isolated by workspace/conversation", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const repository = new MessageDraftRepository();
  const file = new NodeFile(["photo"], "photo.png", { type: "image/png" });
  const first = repository.write("workspace-a:private-1", { file, segments: [{ type: "image" }], resource });
  const last = repository.write("workspace-a:private-1", {
    file,
    segments: [{ type: "text", text: "edited" }],
    resource,
  });
  await Promise.all([first, last, repository.write("workspace-b:private-1", { message: "other" })]);
  const reopened = new MessageDraftRepository();
  const draft = await reopened.read("workspace-a:private-1");
  // Node structuredClone represents File as Blob; the browser preserves File metadata as well.
  expect(draft.file).toBeInstanceOf(NodeBlob);
  expect(await draft.file.text()).toBe("photo");
  expect(draft.segments).toEqual([{ type: "text", text: "edited" }]);
  expect(draft.resource).toEqual(resource);
  expect(await reopened.read("workspace-b:private-1")).toEqual({ message: "other" });
  await reopened.write("workspace-a:private-1", undefined);
  expect(await repository.read("workspace-a:private-1")).toBeUndefined();
  expect(await repository.read("workspace-b:private-1")).toEqual({ message: "other" });
});

test("a failed database open does not poison subsequent draft saves", async () => {
  const factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
  const open = vi.spyOn(factory, "open").mockImplementationOnce(() => {
    throw new DOMException("Storage access was temporarily unavailable.", "SecurityError");
  });
  const repository = new MessageDraftRepository();
  await expect(repository.read("draft")).rejects.toThrow("Storage access was temporarily unavailable.");
  await repository.write("draft", { message: "kept" });
  expect(await repository.read("draft")).toEqual({ message: "kept" });
  expect(open).toHaveBeenCalledTimes(2);
});

test("reopens an unexpectedly closed connection without losing durable drafts", async () => {
  const factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
  const open = vi.spyOn(factory, "open");
  const repository = new MessageDraftRepository();
  await repository.write("draft", { message: "before close" });
  const connection = open.mock.results[0].value.result;
  const closed = new Promise((resolve) => connection.addEventListener("close", resolve, { once: true }));
  forceCloseDatabase(connection);
  await closed;
  expect(await repository.read("draft")).toEqual({ message: "before close" });
  await repository.update("draft", (previous) => ({ ...previous, message: "after close" }));
  expect(await repository.read("draft")).toEqual({ message: "after close" });
  expect(open).toHaveBeenCalledTimes(2);
});

test("one attachment reuses its in-flight upload and acknowledged resource after send failure", async () => {
  const file = new File(["photo"], "photo.png");
  const task = new AttachmentUploadTask(file);
  let finish;
  uploadFile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const uploading = task.upload("/api/resources?workspaceId=a");
  expect(task.upload("/api/resources?workspaceId=a")).toBe(uploading);
  expect(uploadFile).toHaveBeenCalledTimes(1);
  finish(resource);
  await expect(uploading).resolves.toEqual(resource);
  await expect(task.upload("/api/resources?workspaceId=a")).resolves.toEqual(resource);
  expect(uploadFile).toHaveBeenCalledTimes(1);
  await expect(task.upload("/api/resources?workspaceId=b")).rejects.toThrow("different workspace");
});

test("failed uploads can retry and restored resources do not upload their files again", async () => {
  const file = new File(["photo"], "photo.png");
  const task = new AttachmentUploadTask(file);
  uploadFile.mockRejectedValueOnce(new Error("disconnected")).mockResolvedValueOnce(resource);
  await expect(task.upload("/api/resources")).rejects.toThrow("disconnected");
  await expect(task.upload("/api/resources")).resolves.toEqual(resource);
  const restored = new AttachmentUploadTask(file, resource);
  await expect(restored.upload("/api/resources")).resolves.toEqual(resource);
  expect(uploadFile).toHaveBeenCalledTimes(2);
  const controller = new AbortController();
  controller.abort();
  expect(() => restored.upload("/api/resources", { signal: controller.signal })).toThrow();
});
