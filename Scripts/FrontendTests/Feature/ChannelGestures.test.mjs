import { afterEach, expect, test } from "vitest";
import {
  canStartSwipe,
  DirectionalSwipe,
} from "../../../Frontend/qq/client/src/renderer/src/function/utils/directionalSwipe.ts";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

test("small movements leave the surface untouched and vertical intent cannot become navigation", () => {
  const swipe = new DirectionalSwipe();
  swipe.start(0, 0);
  expect(swipe.move(8, 3)).toBeUndefined();
  expect(swipe.move(9, 30)).toBeUndefined();
  expect(swipe.move(150, 32)).toBeUndefined();
  swipe.start(20, 30);
  expect(swipe.move(12, 0)).toBeUndefined();
  expect(swipe.move(-150, 0)).toBeUndefined();
});

test("deliberate horizontal motion tracks total distance without accumulating or doubling the first move", () => {
  const swipe = new DirectionalSwipe();
  swipe.start(10, 50);
  expect(swipe.move(40, 52)).toBe(30);
  expect(swipe.move(80, 53)).toBe(70);
  expect(swipe.move(30, 52)).toBe(20);
  swipe.cancel();
  expect(swipe.move(200, 52)).toBeUndefined();
  swipe.start(100, 20);
  expect(swipe.move(60, 22)).toBe(-40);
});

test("diagonal scrolling is rejected rather than briefly dragging the chat", () => {
  const swipe = new DirectionalSwipe();
  swipe.start(0, 0);
  expect(swipe.move(20, 18)).toBeUndefined();
  expect(swipe.move(80, 20)).toBeUndefined();
});

test("inputs, links, attachment controls and selected text keep their own gestures", () => {
  const surface = document.createElement("div");
  surface.innerHTML =
    '<textarea></textarea><button><span>选择图片</span></button><a href="#">文件</a><div data-swipe-ignore><span>附件</span></div><p>聊天正文</p>';
  document.body.append(surface);
  for (const selector of ["textarea", "button span", "a", "[data-swipe-ignore] span"])
    expect(canStartSwipe(surface.querySelector(selector), surface)).toBe(false);
  expect(canStartSwipe(surface.querySelector("p"), surface)).toBe(true);
  const selection = window.getSelection();
  selection.selectAllChildren(surface.querySelector("p"));
  expect(canStartSwipe(surface.querySelector("p"), surface)).toBe(false);
});

test("nested horizontal scrolling takes priority over chat navigation", () => {
  const surface = document.createElement("div");
  const scroller = document.createElement("pre");
  const content = document.createElement("code");
  scroller.style.overflowX = "auto";
  Object.defineProperties(scroller, { scrollWidth: { value: 800 }, clientWidth: { value: 300 } });
  scroller.append(content);
  surface.append(scroller);
  document.body.append(surface);
  expect(canStartSwipe(content, surface)).toBe(false);
});
