import { afterEach, expect, test, vi } from "vitest";
import { createApp, h, nextTick, reactive } from "vue";
import { useSeneraNavigation } from "../../../Frontend/qq/client/src/renderer/src/runtime/seneraNavigation.ts";
import { login } from "../../../Frontend/qq/client/src/renderer/src/function/connect.ts";
import { useAuthStore } from "../../../Frontend/qq/client/src/renderer/src/state/auth.ts";
import { seneraDirectory } from "../../../Frontend/qq/client/src/renderer/src/runtime/seneraDirectory.ts";

vi.mock("../../../Frontend/qq/client/src/renderer/src/function/connect.ts", async () => {
  const { reactive } = await import("vue");
  return { login: reactive({ status: false }) };
});
vi.mock("../../../Frontend/qq/client/src/renderer/src/state/auth.ts", async () => {
  const { reactive } = await import("vue");
  const auth = reactive({ loginInfo: { uin: 10 } });
  return { useAuthStore: () => auth };
});
vi.mock("../../../Frontend/qq/client/src/renderer/src/runtime/seneraDirectory.ts", async () => {
  const { shallowRef } = await import("vue");
  return { seneraDirectory: shallowRef() };
});
vi.mock("../../../Frontend/qq/client/src/renderer/src/runtime/seneraIdentity.ts", () => ({
  conversationAvatar: (type, id) => `/avatars/${type}/${id}`,
}));
vi.mock("../../../Frontend/qq/client/src/renderer/src/runtime/seneraContext.ts", () => ({
  seneraClientRoot: () => document.querySelector('meta[name="senera-client-root"]')?.content,
}));

const apps = [];
afterEach(async () => {
  for (const app of apps.splice(0)) app.unmount();
  document.head.replaceChildren();
  document.body.replaceChildren();
  localStorage.clear();
  login.status = false;
  seneraDirectory.value = undefined;
  useAuthStore().loginInfo.uin = 10;
  await nextTick();
});

test("restores only after identity and directory arrive, using current contact names and workspace scope", async () => {
  localStorage.setItem(
    "senera-client-navigation:/workspace-a/:10",
    JSON.stringify({ page: "Messages", chat: { type: "group", id: 22 } }),
  );
  const restore = mount("/workspace-a/");
  login.status = true;
  await nextTick();
  expect(restore).not.toHaveBeenCalled();
  seneraDirectory.value = { groups: [{ id: 22, name: "Current group" }], agents: [] };
  await nextTick();
  expect(restore).toHaveBeenCalledWith("Messages", {
    type: "group",
    id: 22,
    name: "Current group",
    avatar: "/avatars/group/22",
  });
  login.status = false;
  login.status = true;
  await nextTick();
  expect(restore).toHaveBeenCalledTimes(1);
  useAuthStore().loginInfo.uin = 11;
  await nextTick();
  expect(restore).toHaveBeenCalledTimes(1);
  const other = mount("/workspace-b/");
  await nextTick();
  expect(other).not.toHaveBeenCalled();
});

test("deleted conversations return to the saved list instead of recreating a stale chat", async () => {
  localStorage.setItem(
    "senera-client-navigation:/workspace-a/:10",
    JSON.stringify({ page: "Friends", chat: { type: "user", id: 22 } }),
  );
  seneraDirectory.value = { groups: [], agents: [] };
  login.status = true;
  const restore = mount("/workspace-a/");
  await nextTick();
  expect(restore).toHaveBeenCalledWith("Friends", undefined);
  expect(localStorage.getItem("senera-client-navigation:/workspace-a/:10")).toBeNull();
});

test("a chat opened before the directory arrives is persisted once initialization completes", async () => {
  const position = reactive({ page: "Home", chat: undefined });
  mount("/workspace-a/", () => position);
  login.status = true;
  position.page = "Messages";
  position.chat = { type: "user", id: 22 };
  await nextTick();
  expect(localStorage.getItem("senera-client-navigation:/workspace-a/:10")).toBeNull();
  seneraDirectory.value = { groups: [], agents: [{ qqUserId: 22, name: "Agent" }] };
  await nextTick();
  expect(JSON.parse(localStorage.getItem("senera-client-navigation:/workspace-a/:10"))).toEqual(position);
});

function mount(root, selection = () => ({ page: "Messages" })) {
  document.head.innerHTML = `<meta name="senera-client-root" content="${root}">`;
  const restore = vi.fn();
  const app = createApp({
    setup() {
      useSeneraNavigation(selection, restore);
      return () => h("div");
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  app.mount(container);
  apps.push(app);
  return restore;
}
