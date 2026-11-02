import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { refreshSeneraSessions } from "../../../Frontend/qq/client/src/renderer/src/runtime/seneraClient.ts";

const state = vi.hoisted(() => ({
  auth: { loginInfo: { uin: 10 } },
  contacts: { userList: [], baseOnMsgList: new Map() },
  updated: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../../../Frontend/qq/client/src/renderer/src/state/auth.ts", () => ({ useAuthStore: () => state.auth }));
vi.mock("../../../Frontend/qq/client/src/renderer/src/state/contact.ts", () => ({
  useContactStore: () => state.contacts,
}));
vi.mock("../../../Frontend/qq/client/src/renderer/src/state/chat.ts", () => ({ useChatStore: vi.fn() }));
vi.mock("../../../Frontend/qq/client/src/renderer/src/state/ui.ts", () => ({ useUIStore: vi.fn() }));
vi.mock("../../../Frontend/qq/client/src/renderer/src/function/base.ts", () => ({
  PopType: { ERR: "error" },
  PopInfo: class {
    add(...args) {
      state.error(...args);
    }
  },
}));
vi.mock("../../../Frontend/qq/client/src/renderer/src/function/utils/msgUtil.ts", () => ({
  updateBaseOnMsgList: () => state.updated(),
}));
vi.mock("../../../Frontend/qq/client/src/renderer/src/function/utils/systemUtil.ts", () => ({
  getViewTime: (time) => time * 1000,
}));
vi.mock("../../../Frontend/qq/client/src/renderer/src/function/msg.ts", () => ({
  normalizeMessagesForPreview: async (payload) => [payload],
  formatMessageData: (payload) => ({
    message_id: payload.message_id,
    raw_msg: payload.text,
    time: payload.time * 1000,
  }),
}));

beforeEach(() => {
  document.head.innerHTML = '<meta name="senera-client-root" content="/workspace-a/">';
  state.auth.loginInfo.uin = 10;
  state.contacts = { userList: [], baseOnMsgList: new Map() };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.head.replaceChildren();
});

function summary(chatId, time, post_type = "message") {
  return {
    chatType: "direct",
    chatId,
    name: `Agent ${chatId}`,
    latest: {
      key: `message:${chatId}`,
      sequence: Number(chatId),
      payload: { post_type, message_id: Number(chatId), text: "saved", time },
    },
  };
}
const response = (conversations) => ({ ok: true, json: async () => ({ conversations }) });

test("recreates durable conversations including notice-only lanes while preserving newer live messages and unread state", async () => {
  const live = { user_id: 22, nickname: "Live", time: 200_000, raw_msg: "newer", new_msg: true };
  state.contacts.baseOnMsgList.set(22, live);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response([summary("21", 100), summary("22", 100), summary("23", 101, "notice")])),
  );
  await refreshSeneraSessions();
  expect(fetch.mock.calls[0][0].pathname).toBe("/workspace-a/conversations");
  expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  expect(state.contacts.baseOnMsgList.get(21)).toMatchObject({ nickname: "Agent 21", raw_msg: "saved", time: 100_000 });
  expect(state.contacts.baseOnMsgList.get(22)).toBe(live);
  expect(live).toMatchObject({ raw_msg: "newer", new_msg: true });
  expect(state.contacts.baseOnMsgList.get(23)).toMatchObject({ nickname: "Agent 23", time: 101_000 });
  expect(state.contacts.baseOnMsgList.get(23).new_msg).toBeUndefined();
  expect(state.updated).toHaveBeenCalledOnce();
});

test("a late pre-reconnection response cannot overwrite a newer conversation snapshot", async () => {
  let finish;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(response([summary("22", 200)])),
  );
  const previous = refreshSeneraSessions();
  await refreshSeneraSessions();
  finish(response([summary("21", 100)]));
  await previous;
  expect(state.contacts.baseOnMsgList.has(21)).toBe(false);
  expect(state.contacts.baseOnMsgList.get(22).time).toBe(200_000);
  expect(state.error).not.toHaveBeenCalled();
});

test("session restoration reports authentication errors and never applies a different identity's response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, json: async () => ({ message: "登录已失效" }) })),
  );
  await refreshSeneraSessions();
  expect(state.error).toHaveBeenCalledWith("error", "登录已失效");
  let finish;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const previous = refreshSeneraSessions();
  state.auth.loginInfo.uin = 11;
  finish(response([summary("21", 100)]));
  await previous;
  expect(state.contacts.baseOnMsgList.size).toBe(0);
});
