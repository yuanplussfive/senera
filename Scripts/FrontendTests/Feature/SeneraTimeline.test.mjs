import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadSeneraTimeline } from "../../../Frontend/qq/client/src/renderer/src/runtime/seneraClient.ts";
import { historyRequestTracker } from "../../../Frontend/qq/client/src/renderer/src/function/utils/historyRequest.ts";

const state = vi.hoisted(() => ({ chat: {}, ui: {}, error: vi.fn() }));
vi.mock("../../../Frontend/qq/client/src/renderer/src/state/chat.ts", () => ({ useChatStore: () => state.chat }));
vi.mock("../../../Frontend/qq/client/src/renderer/src/state/ui.ts", () => ({ useUIStore: () => state.ui }));
vi.mock("../../../Frontend/qq/client/src/renderer/src/state/auth.ts", () => ({
  useAuthStore: () => ({ loginInfo: { uin: 10 } }),
}));
vi.mock("../../../Frontend/qq/client/src/renderer/src/function/base.ts", () => ({
  PopType: { ERR: "error" },
  PopInfo: class {
    add(...args) {
      state.error(...args);
    }
  },
}));
vi.mock("../../../Frontend/qq/client/src/renderer/src/function/msg.ts", () => ({
  normalizeMessagesForPreview: async (payload) => [payload],
  prepareChannelNotice: (payload) => payload,
}));

beforeEach(() => {
  document.head.innerHTML = '<meta name="senera-client-root" content="/workspace-a/">';
  state.chat = { chatInfo: { show: { type: "user", id: "20" } }, messageList: [] };
  state.ui = {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.head.replaceChildren();
});

const entry = (sequence) => ({
  key: `message:${sequence}`,
  sequence,
  payload: { post_type: "message", message_id: sequence },
});
const response = (entries, sequence, { revision = 0, hasMore = false, reset = false, before = null } = {}) => ({
  ok: true,
  json: async () => ({ entries, before, sync: { cursor: { sequence, revision }, hasMore, reset } }),
});
const begin = () => historyRequestTracker.begin(state.chat.chatInfo.show);

test("reconnection catches up all delta pages, deduplicates live messages and applies recalls quietly", async () => {
  const request = begin();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response([entry(1)], 1, { before: 1 }))
      .mockResolvedValueOnce(response([entry(2), entry(3)], 3, { hasMore: true }))
      .mockResolvedValueOnce(
        response(
          [
            entry(4),
            {
              key: "event:recall",
              sequence: 5,
              payload: { post_type: "notice", notice_type: "friend_recall", message_id: 1 },
            },
          ],
          5,
        ),
      ),
  );
  await loadSeneraTimeline(request);
  state.chat.messageList.push({ message_id: 2 });
  await loadSeneraTimeline(request);
  await vi.waitFor(() =>
    expect(state.chat.messageList.map((value) => value.timelineKey)).toEqual([
      "message:2",
      "message:3",
      "message:4",
      "event:recall",
    ]),
  );
  expect(fetch.mock.calls[1][0].searchParams.get("after")).toBe("1");
  expect(fetch.mock.calls[2][0].searchParams.get("after")).toBe("3");
  expect(state.chat.messageList.at(-1).historical).toBe(true);
  expect(state.error).not.toHaveBeenCalled();
});

test("clear generations replace stale history and ignore a late older page", async () => {
  const request = begin();
  let finishOlder;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response([entry(2)], 2, { before: 2 }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOlder = resolve;
          }),
      )
      .mockResolvedValueOnce(response([entry(4)], 4, { revision: 1, reset: true }))
      .mockResolvedValueOnce(response([], 4, { revision: 1 })),
  );
  await loadSeneraTimeline(request);
  const older = loadSeneraTimeline(request, true);
  await loadSeneraTimeline(request);
  finishOlder(response([entry(1)], 2));
  await older;
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  expect(state.chat.messageList.map((value) => value.timelineKey)).toEqual(["message:4"]);
});

test("non-progressing incremental pages report an error instead of fetching forever", async () => {
  const request = begin();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response([entry(1)], 1))
      .mockResolvedValueOnce(response([], 1, { hasMore: true })),
  );
  await loadSeneraTimeline(request);
  await loadSeneraTimeline(request);
  expect(state.error).toHaveBeenCalledWith("error", "消息增量游标未推进，无法继续同步");
  expect(fetch).toHaveBeenCalledTimes(2);
});
