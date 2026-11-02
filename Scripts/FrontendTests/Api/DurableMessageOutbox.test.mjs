import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import { DurableMessageOutbox, DefinitiveMessageRejection } from "../../../Frontend/src/api/durableMessageOutbox.ts";
import { MessageDraftRepository } from "../../../Frontend/src/api/messageDraftRepository.ts";

const scope = () => crypto.randomUUID();
const outbox = () => new DurableMessageOutbox(() => crypto.randomUUID());

test("atomic updates serialize competing documents and abort without overwriting on failure", async () => {
  const key = scope();
  const a = new MessageDraftRepository();
  const b = new MessageDraftRepository();
  await Promise.all(
    Array.from({ length: 20 }, (_, index) => (index % 2 ? a : b).update(key, (value) => (value ?? 0) + 1)),
  );
  expect(await a.read(key)).toBe(20);
  await expect(
    a.update(key, () => {
      throw new Error("cannot change");
    }),
  ).rejects.toThrow("cannot change");
  expect(await b.read(key)).toBe(20);
});

test("a lost receipt survives reopening with the same send ID and complete media payload", async () => {
  const key = scope();
  const payload = { text: "", media: [{ type: "image", file: "senera://resource/a1b2c3" }] };
  const original = outbox();
  await Promise.all([original.prepare(key, payload), original.prepare(key, payload)]);
  const [first] = await original.read(key);
  const deliver = vi.fn().mockRejectedValueOnce(new Error("receipt lost")).mockResolvedValueOnce({ message_id: 42 });
  const accepted = vi.fn();
  await expect(original.drain(key, deliver, accepted)).rejects.toThrow("receipt lost");
  expect(accepted).not.toHaveBeenCalled();
  const reopened = outbox();
  await reopened.drain(key, deliver, accepted);
  expect(deliver.mock.calls.map(([entry]) => entry.id)).toEqual([first.id, first.id]);
  expect(accepted).toHaveBeenCalledWith({ ...first, acknowledgement: { result: { message_id: 42 } } });
  expect(await reopened.read(key)).toBeUndefined();
});

test("a stored acknowledgement finishes draft cleanup without delivering again", async () => {
  const key = scope();
  const original = outbox();
  await original.prepare(key, { text: "sent" });
  const deliver = vi.fn().mockResolvedValue({ message_id: 9 });
  await expect(
    original.drain(key, deliver, async () => {
      throw new Error("page closed");
    }),
  ).rejects.toThrow("page closed");
  const cleanup = vi.fn();
  await outbox().drain(key, deliver, cleanup);
  expect(deliver).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledOnce();
});

test("definitive rejection removes its intent, while newer drafts and scopes remain independent", async () => {
  const key = scope();
  const other = scope();
  const queue = outbox();
  await queue.prepare(key, { text: "rejected" });
  await queue.prepare(key, { text: "newer" });
  await queue.prepare(other, { text: "other" });
  await expect(
    queue.drain(
      key,
      async () => {
        throw new DefinitiveMessageRejection("forbidden");
      },
      vi.fn(),
    ),
  ).rejects.toThrow("forbidden");
  expect((await queue.read(key)).map((value) => value.payload.text)).toEqual(["newer"]);
  expect((await queue.read(other)).map((value) => value.payload.text)).toEqual(["other"]);
});

test("clearing while a delivery is in flight never cleans or sends a replacement draft", async () => {
  const key = scope();
  const queue = outbox();
  await queue.prepare(key, { text: "old" });
  let finish;
  const deliver = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const accepted = vi.fn();
  const sending = queue.drain(key, deliver, accepted);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await queue.clear(key);
  await queue.prepare(key, { text: "replacement" });
  const replacement = vi.fn().mockResolvedValue({ message_id: 5 });
  await queue.drain(key, replacement, accepted);
  finish({ message_id: 4 });
  await sending;
  expect(accepted).toHaveBeenCalledOnce();
  expect(accepted.mock.calls[0][0].payload).toEqual({ text: "replacement" });
  expect(deliver).toHaveBeenCalledOnce();
  expect(await queue.read(key)).toBeUndefined();
});
